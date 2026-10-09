import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { preserveRecordedFiles, recordWorkspaceFile, rescanLegacyFiles } from "../../src/main/services/files/file-object-store";
import { ChatService } from "../../src/main/services/chat-service";
import { readAttachmentTool } from "../../src/main/services/agent-attachment-tools";
import { dispatchAgentTool } from "../../src/main/services/agent-tools";

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

describe("opening a recorded file", () => {
  test("bytes that no longer match the recorded hash are refused, not shown as the recorded file", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-verify-${randomUUID()}.db`));
    const root = join(tmpdir(), `ac-verify-ws-${randomUUID()}`);
    mkdirSync(root, { recursive: true });
    let orgId = "";
    connection.transaction(() => {
      orgId = new OrganizationService(connection.db).createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
    });
    writeFileSync(join(root, "plan.md"), "recorded");
    const fileId = recordWorkspaceFile(connection.db, { orgId, ownerType: "agent", ownerId: null, workspaceRoot: root, relativePath: "plan.md" });
    const deps = { db: connection.db, organization: new OrganizationService(connection.db), chat: new ChatService(connection.db) };
    const ctx = { orgId, agent: { id: "agt_x", modelProviderId: null, modelId: null }, taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: null };
    expect(readAttachmentTool(deps, ctx, { file_id: fileId })).toContain("recorded");
    const stored = (connection.db.prepare("select storage_path from file_objects where id = ?").get(fileId) as { storage_path: string }).storage_path;
    writeFileSync(stored, "tampered");
    expect(() => readAttachmentTool(deps, ctx, { file_id: fileId })).toThrow("plan.md changed on disk since it was recorded; it is not the content that was handed over.");
    connection.close();
  });
});

describe("files scanned before whole-file scanning", () => {
  test("are scanned again when their bytes are intact, and marked as sampled when they are not", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-rescan-${randomUUID()}.db`));
    let orgId = "";
    connection.transaction(() => {
      orgId = new OrganizationService(connection.db).createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
    });
    const path = join(tmpdir(), `ac-rescan-${randomUUID()}.txt`);
    const content = `${"x".repeat(2 * 1024 * 1024)}\nAKIAABCDEFGHIJKLMNOP\n`;
    writeFileSync(path, content);
    const insert = connection.db.prepare(`
      insert into file_objects(id, org_id, name, kind, size_bytes, sha256, storage_path, source_path, owner_type, owner_id, pinned, scan_state, scan_labels_json, created_at)
      values (?, ?, 'notes.txt', 'txt', 1, ?, ?, ?, 'agent', null, 0, 'approved', '["classification:internal"]', ?)
    `);
    insert.run("fil_intact", orgId, createHash("sha256").update(content).digest("hex"), path, path, new Date().toISOString());
    insert.run("fil_gone", orgId, "0".repeat(64), join(tmpdir(), "missing.txt"), join(tmpdir(), "missing.txt"), new Date().toISOString());
    rescanLegacyFiles(connection.db);
    const row = (id: string) => connection.db.prepare("select scan_state, scan_labels_json from file_objects where id = ?").get(id) as { scan_state: string; scan_labels_json: string };
    expect(row("fil_intact").scan_state).toBe("blocked");
    expect(JSON.parse(row("fil_intact").scan_labels_json)).toContain("scan:whole-file");
    expect(row("fil_gone")).toEqual({ scan_state: "approved", scan_labels_json: '["classification:internal","scan:legacy-sample"]' });
    connection.close();
  });
});

describe("a file write whose record fails", () => {
  test("leaves the workspace and the artifact store as they were", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-partial-${randomUUID()}.db`));
    const root = join(tmpdir(), `ac-partial-ws-${randomUUID()}`);
    mkdirSync(root, { recursive: true });
    let orgId = "";
    let ceoId = "";
    connection.transaction(() => {
      const organization = new OrganizationService(connection.db);
      orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
      ceoId = organization.createAgent({ orgId, name: "CEO", role: "CEO", department: "Executive", modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: null, roleLevel: "c_suite" });
    });
    writeFileSync(join(root, "kept.md"), "old");
    connection.db.exec("create trigger registry_down before insert on file_objects begin select raise(abort, 'registry down'); end;");
    const deps = { db: connection.db, organization: new OrganizationService(connection.db), chat: new ChatService(connection.db) };
    const ctx = { orgId, agent: { id: ceoId, modelProviderId: null, modelId: null }, taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: { id: "wsp", localPath: root, writeAccess: true } };
    expect(dispatchAgentTool(deps, ctx, { id: "c1", name: "write_deliverable", arguments: { path: "kept.md", content: "new" } })).toBe("ERROR: registry down");
    expect(dispatchAgentTool(deps, ctx, { id: "c2", name: "write_deliverable", arguments: { path: "fresh.md", content: "new" } })).toBe("ERROR: registry down");
    expect(readFileSync(join(root, "kept.md"), "utf8")).toBe("old");
    expect(existsSync(join(root, "fresh.md"))).toBe(false);
    // No content copy outlives the record that failed.
    expect(existsSync(join(root, ".agentcompany", "files")) ? readdirSync(join(root, ".agentcompany", "files")) : []).toEqual([]);
    connection.close();
  });

  test("a damaged content copy is replaced, never reused", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-damaged-${randomUUID()}.db`));
    const root = join(tmpdir(), `ac-damaged-ws-${randomUUID()}`);
    mkdirSync(join(root, ".agentcompany", "files"), { recursive: true });
    let orgId = "";
    connection.transaction(() => {
      orgId = new OrganizationService(connection.db).createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
    });
    writeFileSync(join(root, "plan.md"), "new");
    const sha = createHash("sha256").update("new").digest("hex");
    writeFileSync(join(root, ".agentcompany", "files", `${sha}.md`), "n");
    const fileId = recordWorkspaceFile(connection.db, { orgId, ownerType: "agent", ownerId: null, workspaceRoot: root, relativePath: "plan.md" });
    const stored = (connection.db.prepare("select storage_path from file_objects where id = ?").get(fileId) as { storage_path: string }).storage_path;
    expect(readFileSync(stored, "utf8")).toBe("new");
    connection.close();
  });
});
