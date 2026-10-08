import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { preserveRecordedFiles, recordWorkspaceFile } from "../../src/main/services/files/file-object-store";

describe("recorded workspace files", () => {
  test("a file id keeps the bytes it was recorded with after the workspace file is rewritten", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-versions-${randomUUID()}.db`));
    const root = join(tmpdir(), `ac-versions-ws-${randomUUID()}`);
    mkdirSync(root, { recursive: true });
    let orgId = "";
    connection.transaction(() => {
      orgId = new OrganizationService(connection.db).createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
    });
    const record = () => recordWorkspaceFile(connection.db, { orgId, ownerType: "agent", ownerId: null, workspaceRoot: root, relativePath: "plan.md" });
    const file = (id: string) => connection.db.prepare("select storage_path, superseded_at from file_objects where id = ?").get(id) as { storage_path: string; superseded_at: string | null };

    writeFileSync(join(root, "plan.md"), "handed over");
    const first = record();
    expect(record()).toBe(first);
    writeFileSync(join(root, "plan.md"), "rewritten later");
    const second = record();

    expect(second).not.toBe(first);
    expect(readFileSync(file(first).storage_path, "utf8")).toBe("handed over");
    expect(readFileSync(file(second).storage_path, "utf8")).toBe("rewritten later");
    expect(file(first).superseded_at).not.toBeNull();
    expect(file(second).superseded_at).toBeNull();
    connection.close();
  });

  test("ids recorded before copies existed get their bytes kept at startup, with their extension", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-legacy-${randomUUID()}.db`));
    const root = join(tmpdir(), `ac-legacy-ws-${randomUUID()}`);
    mkdirSync(root, { recursive: true });
    let orgId = "";
    connection.transaction(() => {
      orgId = new OrganizationService(connection.db).createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
      new OrganizationService(connection.db).createWorkspace({ orgId, name: "HQ", localPath: root, projectId: null });
    });
    const live = join(root, "report.md");
    writeFileSync(live, "as handed over");
    const sha = createHash("sha256").update("as handed over").digest("hex");
    const now = new Date().toISOString();
    connection.db.prepare(`
      insert into file_objects(id, org_id, name, kind, size_bytes, sha256, storage_path, source_path, owner_type, owner_id, pinned, scan_state, scan_labels_json, created_at)
      values ('fil_legacy', ?, 'report.md', 'doc', 14, ?, ?, ?, 'agent', null, 0, 'approved', '[]', ?)
    `).run(orgId, sha, live, live, now);
    preserveRecordedFiles(connection.db);
    writeFileSync(live, "rewritten");
    const kept = (connection.db.prepare("select storage_path from file_objects where id = 'fil_legacy'").get() as { storage_path: string }).storage_path;
    expect(kept.endsWith(`${sha}.md`)).toBe(true);
    expect(readFileSync(kept, "utf8")).toBe("as handed over");
    connection.close();
  });
});
