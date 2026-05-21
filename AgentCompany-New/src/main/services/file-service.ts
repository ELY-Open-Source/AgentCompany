import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { dialog } from "electron";
import type { ImportFileInput } from "../../shared/commands";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";

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
    const hash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
    const orgDir = join(this.artifactRoot, orgId);
    mkdirSync(orgDir, { recursive: true });
    const target = join(orgDir, `${id}-${basename(sourcePath)}`);
    copyFileSync(sourcePath, target);
    this.db.prepare(`
      insert into file_objects(id, org_id, name, kind, size_bytes, sha256, storage_path, owner_type, owner_id, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      now,
    );
    this.audit.record({
      orgId,
      entityType: "file_object",
      entityId: id,
      actorType: "system",
      actorId: null,
      action: "imported",
      payload: { sha256: hash, sizeBytes: stats.size },
    });
    return id;
  }
}
