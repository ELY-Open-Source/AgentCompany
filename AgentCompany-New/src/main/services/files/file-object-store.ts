import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { FILE_SCAN_STATE, type FileScanState } from "../../../shared/domain";
import { createId } from "../../../shared/ids";

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

const TEXT_SCAN_PATTERNS: TextScanPattern[] = [
  { label: "dlp:private-key", pattern: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PRIVATE )?PRIVATE KEY-----/i, block: true },
  { label: "dlp:aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/, block: true },
  { label: "dlp:github-token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/, block: true },
  { label: "dlp:provider-secret", pattern: /\bsk-[A-Za-z0-9]{32,}\b/, block: true },
  { label: "dlp:credential", pattern: /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9_\-./+=]{20,}/i, block: true },
  { label: "dlp:ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/, block: true },
  { label: "dlp:email", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, block: false },
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

export function scanFileContent(name: string, bytes: Buffer): FileScanResult {
  const textSample = sampleText(bytes);
  const labels = new Set(scanLabels(name, bytes.length));
  let blocked = false;
  if (bytes.subarray(0, Math.min(bytes.length, 1024 * 1024)).toString("latin1").includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) {
    labels.add("av:eicar");
    blocked = true;
  }
  for (const scan of TEXT_SCAN_PATTERNS) {
    if (!scan.pattern.test(textSample)) continue;
    labels.add(scan.label);
    if (scan.block) blocked = true;
  }
  if (containsPaymentCard(textSample)) {
    labels.add("dlp:payment-card");
    blocked = true;
  }
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
  storagePath: string;
  ownerType: string;
  ownerId: string | null;
  scan: FileScanResult;
  now: string;
}

/**
 * Inserts (or refreshes, keyed on org_id + storage_path) a file object and, on
 * first insert, grants the workspace org-group read/manage access so the file
 * surfaces on the Files page and can be attached in chat. Re-writing the same
 * path updates the existing row instead of creating a duplicate.
 */
export function upsertFileObject(db: DatabaseSync, input: FileObjectInput): string {
  const existing = db.prepare("select id from file_objects where org_id = ? and storage_path = ?")
    .get(input.orgId, input.storagePath) as { id: string } | undefined;
  const labelsJson = JSON.stringify(input.scan.labels);
  if (existing) {
    db.prepare(`
      update file_objects
      set name = ?, kind = ?, size_bytes = ?, sha256 = ?, owner_type = ?, owner_id = ?,
          scan_state = ?, scan_labels_json = ?, scanned_at = ?, updated_at = ?
      where id = ?
    `).run(
      input.name,
      input.kind,
      input.sizeBytes,
      input.sha256,
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
      id, org_id, name, kind, size_bytes, sha256, storage_path,
      owner_type, owner_id, space_id, pinned, scan_state, scan_labels_json, scanned_at, created_at, updated_at
    )
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.orgId,
    input.name,
    input.kind,
    input.sizeBytes,
    input.sha256,
    input.storagePath,
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
  grantWorkspaceAccess(db, input.orgId, id, input.now);
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
  const absolute = resolve(input.workspaceRoot, input.relativePath);
  const bytes = readFileSync(absolute);
  const name = basename(input.relativePath);
  const scan = scanFileContent(name, bytes);
  const now = new Date().toISOString();
  db.exec("begin immediate");
  try {
    const id = upsertFileObject(db, {
      orgId: input.orgId,
      name,
      kind: fileKind(name),
      sizeBytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      storagePath: absolute,
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      scan,
      now,
    });
    db.exec("commit");
    return id;
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
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

function sampleText(bytes: Buffer): string {
  return bytes.subarray(0, Math.min(bytes.length, 1024 * 1024)).toString("utf8");
}

function containsPaymentCard(text: string): boolean {
  const matches = text.match(/\b(?:\d[ -]?){13,19}\b/g) ?? [];
  return matches.some((match) => luhnValid(match.replace(/[ -]/g, "")));
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
