import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { dialog, shell } from "electron";
import type { ImportFileInput, OpenFileInput } from "../../shared/commands";
import { FILE_SCAN_STATE } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";
import { fileKind, readVerifiedFile, scanFileContent, upsertFileObject } from "./files/file-object-store";

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
    return this.importPath(input.orgId, result.filePaths[0], input.spaceId ?? null);
  }

  /** A file imported into a direct conversation or restricted channel is readable by that space's members only. */
  importPath(orgId: string, sourcePath: string, spaceId: string | null): string {
    const access = spaceId ? spaceAccess(this.db, orgId, spaceId) : "workspace";
    const id = createId("fil");
    const now = new Date().toISOString();
    const stats = statSync(sourcePath);
    if (!stats.isFile()) throw new Error("Selected path is not a file.");
    const name = basename(sourcePath);
    const bytes = readFileSync(sourcePath);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const scan = scanFileContent(name, bytes);
    const orgDir = join(this.artifactRoot, orgId);
    mkdirSync(orgDir, { recursive: true });
    const target = join(orgDir, `${id}-${name}`);
    copyFileSync(sourcePath, target);
    this.db.exec("begin immediate");
    try {
      upsertFileObject(this.db, {
        id,
        orgId,
        name,
        kind: fileKind(name),
        sizeBytes: stats.size,
        sha256: hash,
        storagePath: target,
        sourcePath: target,
        access,
        ownerType: "system",
        ownerId: null,
        scan,
        now,
      });
      this.audit.record({
        orgId,
        entityType: "file_object",
        entityId: id,
        actorType: "system",
        actorId: null,
        action: "imported",
        payload: { sha256: hash, sizeBytes: stats.size, scanState: scan.state, scanLabels: scan.labels, objectRef: target },
      });
      this.db.exec("commit");
    } catch (error) {
      this.db.exec("rollback");
      throw error;
    }
    return id;
  }

  async openFile(input: OpenFileInput): Promise<void> {
    const row = this.db.prepare(
      "select name, storage_path as storagePath, sha256, scan_state as scanState from file_objects where id = ? and org_id = ?",
    ).get(input.fileId, input.orgId) as { name: string; storagePath: string; sha256: string; scanState: string } | undefined;
    if (!row) throw new Error("File was not found.");
    if (row.scanState !== FILE_SCAN_STATE.APPROVED) throw new Error("Blocked files cannot be opened.");
    // What opens must still be what was recorded; a file changed by another program is refused, not shown under the old record.
    readVerifiedFile(row);
    const failure = await shell.openPath(row.storagePath);
    if (failure) throw new Error(failure);
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

}

function spaceAccess(db: DatabaseSync, orgId: string, spaceId: string): "workspace" | Array<{ type: "employee" | "agent"; id: string }> {
  const space = db.prepare("select visibility, space_type from chat_spaces where id = ? and org_id = ?").get(spaceId, orgId) as { visibility: string; space_type: string } | undefined;
  if (!space) throw new Error("The conversation to import into was not found.");
  if (space.visibility === "workspace" && space.space_type !== "direct") return "workspace";
  return db.prepare("select principal_type as type, principal_id as id from chat_memberships where space_id = ? and principal_type in ('employee', 'agent')")
    .all(spaceId) as Array<{ type: "employee" | "agent"; id: string }>;
}
