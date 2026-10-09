import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { FILE_SCAN_STATE, type FileScanState } from "../../../shared/domain";
import { createId } from "../../../shared/ids";
import { resolveWorkspacePath } from "./workspace-path";
import { withSavepoint } from "../../database/connection";

export interface FileScanResult {
  state: FileScanState;
  labels: string[];
  scannedAt: string;
}

interface TextScanPattern {
  label: string;
  pattern: RegExp;
  block: boolean;
}

const SCAN_WINDOW_BYTES = 1024 * 1024;
const SCAN_OVERLAP_BYTES = 4096;
const SCAN_CONTEXT_BYTES = 64;
/** Zip (office documents too), PDF, gzip, 7z, RAR, bzip2, xz, PNG, JPEG and GIF. */
const CONTAINER_SIGNATURES = [
  [0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x25, 0x50, 0x44, 0x46], [0x1f, 0x8b], [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c],
  [0x52, 0x61, 0x72, 0x21], [0x42, 0x5a, 0x68], [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00], [0x89, 0x50, 0x4e, 0x47], [0xff, 0xd8, 0xff], [0x47, 0x49, 0x46, 0x38],
];

// Every quantifier is bounded, so no match is longer than the window overlap and none is cut in two.
const TEXT_SCAN_PATTERNS: TextScanPattern[] = [
  { label: "dlp:private-key", pattern: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PRIVATE )?PRIVATE KEY-----/i, block: true },
  { label: "dlp:aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/, block: true },
  { label: "dlp:github-token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{30}/, block: true },
  { label: "dlp:provider-secret", pattern: /\bsk-[A-Za-z0-9]{32}/, block: true },
  { label: "dlp:credential", pattern: /\b(?:api[_-]?key|secret|token|password)[ \t]{0,16}[:=][ \t]{0,16}["']?[A-Za-z0-9_\-./+=]{20}/i, block: true },
  { label: "dlp:ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/, block: true },
  { label: "dlp:email", pattern: /\b[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,24}\b/i, block: false },
];

export function fileKind(path: string): string {
  const ext = extname(path).toLowerCase().replace(".", "");
  if (!ext) return "file";
  if (["md", "markdown"].includes(ext)) return "md";
  if (["pdf"].includes(ext)) return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "img";
  if (["csv", "xlsx", "xls"].includes(ext)) return "sheet";
  if (["doc", "docx", "txt"].includes(ext)) return "doc";
  return ext;
}

/** Pattern checks for secrets and the antivirus test string over the whole file; not an antivirus engine, and compressed contents are not opened. */
export function scanFileContent(name: string, bytes: Buffer): FileScanResult {
  const labels = new Set(scanLabels(name, bytes.length));
  let blocked = false;
  // Overlapping windows cover every byte with bounded memory; the overlap is longer than any pattern match.
  for (let start = 0; start === 0 || start < bytes.length; start += SCAN_WINDOW_BYTES) {
    // A window owns the matches that start in its own MiB; context on both sides keeps word boundaries real at the cuts.
    const ownEnd = Math.min(bytes.length, start + SCAN_WINDOW_BYTES);
    const lead = bytes.subarray(Math.max(0, start - SCAN_CONTEXT_BYTES), start).toString("utf8");
    const own = bytes.subarray(start, ownEnd).toString("utf8");
    const tail = bytes.subarray(ownEnd, Math.min(bytes.length, ownEnd + SCAN_OVERLAP_BYTES + SCAN_CONTEXT_BYTES)).toString("utf8");
    const text = lead + own + tail;
    const range = { from: lead.length, until: lead.length + own.length };
    if (bytes.subarray(start, ownEnd + SCAN_OVERLAP_BYTES).toString("latin1").includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) {
      labels.add("av:eicar");
      blocked = true;
    }
    for (const scan of TEXT_SCAN_PATTERNS) {
      if (!matchesWithin(scan.pattern, text, range)) continue;
      labels.add(scan.label);
      if (scan.block) blocked = true;
    }
    if (containsPaymentCard(text, range)) {
      labels.add("dlp:payment-card");
      blocked = true;
    }
  }
  if (isEncodedContainer(bytes)) labels.add("scan:contents-not-inspected");
  labels.add("scan:whole-file");
  labels.add(blocked ? "classification:restricted" : labels.has("dlp:email") ? "classification:confidential" : "classification:internal");
  return {
    state: blocked ? FILE_SCAN_STATE.BLOCKED : FILE_SCAN_STATE.APPROVED,
    labels: [...labels].sort(),
    scannedAt: new Date().toISOString(),
  };
}

export interface FileObjectInput {
  /** Optional explicit id; defaults to a generated `fil` id on insert. */
  id?: string;
  orgId: string;
  name: string;
  kind: string;
  sizeBytes: number;
  sha256: string;
  /** Where the bytes of this id live, never rewritten: a content-addressed copy, or an imported file's own copy. */
  storagePath: string;
  /** The path the file came from; one id per content of it, the newest current and older ones superseded. */
  sourcePath: string;
  /** Who may read it once it exists: the whole workspace, or only these principals (a private conversation's members). */
  access: "workspace" | Array<{ type: "employee" | "agent"; id: string }>;
  ownerType: string;
  ownerId: string | null;
  scan: FileScanResult;
  now: string;
}

/** One id per content of a source path, granted to the workspace on first insert; recording it makes it the path's current version. */
export function upsertFileObject(db: DatabaseSync, input: FileObjectInput): string {
  const id = writeFileObject(db, input);
  // Earlier contents of the same path stay readable under their own ids, marked as no longer current.
  db.prepare("update file_objects set superseded_at = ? where org_id = ? and source_path = ? and id <> ? and superseded_at is null")
    .run(input.now, input.orgId, input.sourcePath, id);
  db.prepare("update file_objects set superseded_at = null where id = ?").run(id);
  return id;
}

function writeFileObject(db: DatabaseSync, input: FileObjectInput): string {
  const existing = db.prepare("select id from file_objects where org_id = ? and source_path = ? and sha256 = ?")
    .get(input.orgId, input.sourcePath, input.sha256) as { id: string } | undefined;
  const labelsJson = JSON.stringify(input.scan.labels);
  if (existing) {
    db.prepare(`
      update file_objects
      set name = ?, kind = ?, size_bytes = ?, sha256 = ?, storage_path = ?, owner_type = ?, owner_id = ?,
          scan_state = ?, scan_labels_json = ?, scanned_at = ?, updated_at = ?
      where id = ?
    `).run(
      input.name,
      input.kind,
      input.sizeBytes,
      input.sha256,
      input.storagePath,
      input.ownerType,
      input.ownerId,
      input.scan.state,
      labelsJson,
      input.scan.scannedAt,
      input.now,
      existing.id,
    );
    return existing.id;
  }
  const id = input.id ?? createId("fil");
  db.prepare(`
    insert into file_objects(
      id, org_id, name, kind, size_bytes, sha256, storage_path, source_path,
      owner_type, owner_id, space_id, pinned, scan_state, scan_labels_json, scanned_at, created_at, updated_at
    )
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.orgId,
    input.name,
    input.kind,
    input.sizeBytes,
    input.sha256,
    input.storagePath,
    input.sourcePath,
    input.ownerType,
    input.ownerId,
    null,
    0,
    input.scan.state,
    labelsJson,
    input.scan.scannedAt,
    input.now,
    input.now,
  );
  if (input.access === "workspace") grantWorkspaceAccess(db, input.orgId, id, input.now);
  else for (const principal of input.access) grantPrincipalAccess(db, input.orgId, id, principal, input.now);
  return id;
}

/**
 * Records a file an agent wrote into the bound workspace as a first-class file
 * object so it appears under that agent's department on the Files page.
 */
export function recordWorkspaceFile(db: DatabaseSync, input: {
  orgId: string;
  ownerType: string;
  ownerId: string | null;
  workspaceRoot: string;
  relativePath: string;
}): string {
  const { absolute } = resolveWorkspacePath(input.workspaceRoot, input.relativePath);
  const bytes = readFileSync(absolute);
  const name = basename(input.relativePath);
  const scan = scanFileContent(name, bytes);
  const now = new Date().toISOString();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  // The id keeps exactly these bytes: a content-addressed copy the workspace file can be rewritten without touching.
  const copy = keepCopy(input.workspaceRoot, absolute, sha256, bytes);
  // A savepoint, not a transaction: an approved deliverable is recorded inside the approval's own transaction.
  return withSavepoint(db, "record_workspace_file", () => upsertFileObject(db, {
    orgId: input.orgId,
    name,
    kind: fileKind(name),
    sizeBytes: bytes.byteLength,
    sha256,
    storagePath: copy,
    sourcePath: absolute,
    access: "workspace",
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    scan,
    now,
  }));
}

/** A recorded file's bytes, refused when they are gone or no longer match the hash it was recorded with. */
export function readVerifiedFile(file: { name: string; storagePath: string; sha256: string }): Buffer {
  if (!existsSync(file.storagePath)) throw new Error(`${file.name} is no longer on disk.`);
  const bytes = readFileSync(file.storagePath);
  if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
    console.warn(`[files] ${file.storagePath} no longer matches its recorded hash ${file.sha256}`);
    throw new Error(`${file.name} changed on disk since it was recorded; it is not the content that was handed over.`);
  }
  return bytes;
}

/** The content-addressed copy of a workspace file, written once; it keeps the extension so the file still opens with its app. */
function keepCopy(workspaceRoot: string, source: string, sha256: string, bytes: Buffer): string {
  const copy = join(workspaceRoot, ".agentcompany", "files", `${sha256}${extname(source)}`);
  if (!existsSync(copy)) {
    mkdirSync(dirname(copy), { recursive: true });
    writeFileSync(copy, bytes);
  }
  return copy;
}

/** Files scanned before whole-file scanning are scanned again when their bytes are still the recorded ones; the rest are marked as sampled. */
export function rescanLegacyFiles(db: DatabaseSync): void {
  const rows = db.prepare("select id, name, sha256, storage_path, scan_labels_json from file_objects where scan_labels_json not like '%scan:whole-file%'")
    .all() as Array<{ id: string; name: string; sha256: string; storage_path: string; scan_labels_json: string }>;
  for (const row of rows) {
    const bytes = existsSync(row.storage_path) ? readFileSync(row.storage_path) : null;
    if (bytes && createHash("sha256").update(bytes).digest("hex") === row.sha256) {
      const scan = scanFileContent(row.name, bytes);
      db.prepare("update file_objects set scan_state = ?, scan_labels_json = ?, scanned_at = ? where id = ?").run(scan.state, JSON.stringify(scan.labels), scan.scannedAt, row.id);
      continue;
    }
    const labels = [...new Set([...(JSON.parse(row.scan_labels_json) as string[]), "scan:legacy-sample"])].sort();
    db.prepare("update file_objects set scan_labels_json = ? where id = ?").run(JSON.stringify(labels), row.id);
  }
}

/** Ids recorded before copies existed still point at the live file; those whose bytes are unchanged get their copy now. */
export function preserveRecordedFiles(db: DatabaseSync): void {
  const workspaces = db.prepare("select org_id, local_path from workspaces").all() as Array<{ org_id: string; local_path: string }>;
  const rows = db.prepare("select id, org_id, sha256, storage_path from file_objects where storage_path = source_path")
    .all() as Array<{ id: string; org_id: string; sha256: string; storage_path: string }>;
  for (const row of rows) {
    const workspace = workspaces.find((candidate) => candidate.org_id === row.org_id && isInside(candidate.local_path, row.storage_path));
    if (!workspace || !existsSync(row.storage_path)) continue;
    const bytes = readFileSync(row.storage_path);
    if (createHash("sha256").update(bytes).digest("hex") !== row.sha256) {
      console.warn(`[files] ${row.id} was rewritten before its bytes could be kept; it opens the current file`);
      continue;
    }
    db.prepare("update file_objects set storage_path = ? where id = ?").run(keepCopy(workspace.local_path, row.storage_path, row.sha256, bytes), row.id);
  }
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Whether an agent may read a file: it owns it, or holds a grant of its own or the workspace's. */
export function agentCanReadFile(db: DatabaseSync, orgId: string, fileId: string, agentId: string): boolean {
  return Boolean(db.prepare(`
    select 1 from file_objects f where f.id = ? and f.org_id = ? and (
      (f.owner_type = 'agent' and f.owner_id = ?)
      or exists (
        select 1 from file_access_grants g where g.file_id = f.id and g.access_level in ('read', 'manage')
          and ((g.granted_to_type = 'agent' and g.granted_to_id = ?) or (g.granted_to_type = 'org_group' and g.granted_to_id = ?))
      )
    )
  `).get(fileId, orgId, agentId, agentId, `${orgId}:workspace`));
}

function grantPrincipalAccess(db: DatabaseSync, orgId: string, fileId: string, principal: { type: string; id: string }, now: string): void {
  db.prepare(`
    insert into file_access_grants(
      id, org_id, file_id, granted_to_type, granted_to_id, granted_by_type, granted_by_id,
      source_message_id, source_thread_id, access_level, created_at
    )
    values (?, ?, ?, ?, ?, 'system', null, null, null, 'read', ?)
  `).run(createId("fgr"), orgId, fileId, principal.type, principal.id, now);
}

function grantWorkspaceAccess(db: DatabaseSync, orgId: string, fileId: string, now: string): void {
  db.prepare(`
    insert into file_access_grants(
      id, org_id, file_id, granted_to_type, granted_to_id, granted_by_type, granted_by_id,
      source_message_id, source_thread_id, access_level, created_at
    )
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    createId("fgr"),
    orgId,
    fileId,
    "org_group",
    `${orgId}:workspace`,
    "system",
    null,
    null,
    null,
    "manage",
    now,
  );
}

function scanLabels(name: string, sizeBytes: number): string[] {
  const labels = new Set<string>([`kind:${fileKind(name)}`]);
  if (sizeBytes === 0) labels.add("empty");
  if (sizeBytes > 100 * 1024 * 1024) labels.add("large");
  return [...labels].sort();
}

/** Archives, office documents, PDFs and images keep their contents compressed or encoded, so a byte scan cannot see inside them. */
function isEncodedContainer(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 12);
  const starts = (signature: number[]): boolean => signature.every((byte, index) => head[index] === byte);
  return CONTAINER_SIGNATURES.some(starts) || (starts([0x52, 0x49, 0x46, 0x46]) && head.subarray(8, 12).toString("latin1") === "WEBP");
}

/** Whether a match starts in the range; text around it still counts as context for boundaries. */
function matchesWithin(pattern: RegExp, text: string, range: { from: number; until: number }): boolean {
  const search = new RegExp(pattern.source, `${pattern.flags}g`);
  search.lastIndex = range.from;
  const match = search.exec(text);
  return match !== null && match.index < range.until;
}

function containsPaymentCard(text: string, range: { from: number; until: number }): boolean {
  const search = /\b(?:\d[ -]?){13,19}\b/g;
  search.lastIndex = range.from;
  for (let match = search.exec(text); match && match.index < range.until; match = search.exec(text)) {
    if (luhnValid(match[0].replace(/[ -]/g, ""))) return true;
  }
  return false;
}

function luhnValid(value: string): boolean {
  if (!/^\d{13,19}$/.test(value)) return false;
  let sum = 0;
  let doubleDigit = false;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}
