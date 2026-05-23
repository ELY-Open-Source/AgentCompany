import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { dialog } from "electron";
import type { ImportFileInput } from "../../shared/commands";
import { FILE_SCAN_STATE } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";

interface FileScanResult {
  state: typeof FILE_SCAN_STATE.APPROVED;
  labels: string[];
  scannedAt: string;
}

function fileKind(path: string): string {
  const ext = extname(path).toLowerCase().replace(".", "");
  if (!ext) return "file";
  if (["md", "markdown"].includes(ext)) return "md";
  if (["pdf"].includes(ext)) return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "img";
  if (["csv", "xlsx", "xls"].includes(ext)) return "sheet";
  if (["doc", "docx", "txt"].includes(ext)) return "doc";
  return ext;
}

export class FileService {
  private readonly audit: AuditService;

  constructor(
    private readonly db: DatabaseSync,
    private readonly artifactRoot: string,
  ) {
    this.audit = new AuditService(db);
    mkdirSync(this.artifactRoot, { recursive: true });
  }

  async importFile(input: ImportFileInput): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      securityScopedBookmarks: true,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return this.importPath(input.orgId, result.filePaths[0]);
  }

  importPath(orgId: string, sourcePath: string): string {
    const id = createId("fil");
    const now = new Date().toISOString();
    const stats = statSync(sourcePath);
    if (!stats.isFile()) throw new Error("Selected path is not a file.");
    const bytes = readFileSync(sourcePath);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const scan = scanFile(sourcePath, bytes);
    const orgDir = join(this.artifactRoot, orgId);
    mkdirSync(orgDir, { recursive: true });
    const target = join(orgDir, `${id}-${basename(sourcePath)}`);
    copyFileSync(sourcePath, target);
    this.db.exec("begin immediate");
    try {
      this.db.prepare(`
        insert into file_objects(
          id, org_id, name, kind, size_bytes, sha256, storage_path,
          owner_type, owner_id, space_id, pinned, scan_state, scan_labels_json, scanned_at, created_at, updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        orgId,
        basename(sourcePath),
        fileKind(sourcePath),
        stats.size,
        hash,
        target,
        "system",
        null,
        null,
        0,
        scan.state,
        JSON.stringify(scan.labels),
        scan.scannedAt,
        now,
        now,
      );
      this.grantWorkspaceAccess(orgId, id, now);
      this.audit.record({
        orgId,
        entityType: "file_object",
        entityId: id,
        actorType: "system",
        actorId: null,
        action: "imported",
        payload: { sha256: hash, sizeBytes: stats.size, scanState: scan.state },
      });
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
    return id;
  }

  setPinned(orgId: string, fileId: string, pinned: boolean): void {
    const result = this.db.prepare(
      "update file_objects set pinned = ?, updated_at = ? where id = ? and org_id = ?",
    ).run(pinned ? 1 : 0, new Date().toISOString(), fileId, orgId);
    if (result.changes === 0) throw new Error("File was not found.");
    this.audit.record({
      orgId,
      entityType: "file_object",
      entityId: fileId,
      actorType: "employee",
      actorId: null,
      action: pinned ? "pinned" : "unpinned",
      payload: { fileId },
    });
  }

  private grantWorkspaceAccess(orgId: string, fileId: string, now: string): void {
    this.db.prepare(`
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
}

function scanFile(sourcePath: string, bytes: Buffer): FileScanResult {
  const sample = bytes.subarray(0, Math.min(bytes.length, 1024 * 1024)).toString("latin1");
  if (sample.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) {
    throw new Error("File scan blocked a known malware signature.");
  }
  return {
    state: FILE_SCAN_STATE.APPROVED,
    labels: scanLabels(sourcePath, bytes.length),
    scannedAt: new Date().toISOString(),
  };
}

function scanLabels(sourcePath: string, sizeBytes: number): string[] {
  const labels = new Set<string>([`kind:${fileKind(sourcePath)}`]);
  if (sizeBytes === 0) labels.add("empty");
  if (sizeBytes > 100 * 1024 * 1024) labels.add("large");
  return [...labels].sort();
}
