import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { dispatchAgentTool, type AgentToolContext } from "../../src/main/services/agent-tools";

function harness() {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-attach-${randomUUID()}.db`));
  const organization = new OrganizationService(connection.db);
  let orgId = "";
  let otherOrgId = "";
  connection.transaction(() => {
    orgId = organization.createOrganization({ organizationName: "A", employeeName: "Yang", mission: "m", goal: "g" });
    otherOrgId = organization.createOrganization({ organizationName: "B", employeeName: "Lee", mission: "m", goal: "g" });
  });
  const addFile = (owner: string, name: string, content: string | Buffer, scanState = "approved") => {
    const path = join(tmpdir(), `ac-attach-${randomUUID()}-${name}`);
    writeFileSync(path, content);
    const fileId = `fil_${randomUUID()}`;
    connection.db.prepare(`
      insert into file_objects(id, org_id, name, kind, size_bytes, sha256, storage_path, owner_type, owner_id, created_at, scan_state)
      values (?, ?, ?, 'md', 1, ?, ?, 'employee', null, ?, ?)
    `).run(fileId, owner, name, createHash("sha256").update(content).digest("hex"), path, new Date().toISOString(), scanState);
    return fileId;
  };
  const ctx: AgentToolContext = {
    orgId, agent: { id: "agt_x", modelProviderId: null, modelId: null },
    taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: null,
  };
  const read = (fileId: string) => dispatchAgentTool(
    { db: connection.db, organization, chat: new ChatService(connection.db) },
    ctx,
    { id: "c", name: "read_attachment", arguments: { file_id: fileId } },
  );
  return { connection, orgId, otherOrgId, addFile, read };
}

describe("read_attachment", () => {
  test("reads text, caps long files, and names binary files", () => {
    const h = harness();
    expect(h.read(h.addFile(h.orgId, "notes.md", "hello attachment"))).toBe("hello attachment");
    const long = h.read(h.addFile(h.orgId, "big.md", "x".repeat(30_000)));
    expect(long).toContain("[line 1 continues: pass start_line=1 and start_column=24001]");
    expect(h.read(h.addFile(h.orgId, "logo.png", Buffer.from([137, 80, 78, 71, 0, 1, 2])))).toBe("logo.png is a binary file (7 bytes); it has no text to read.");
    expect(h.read(h.addFile(h.orgId, "blob.bin", Buffer.from([0x80, 0x81, 0xfe, 0xff])))).toBe("blob.bin is a binary file (4 bytes); it has no text to read.");
    expect(h.read(h.addFile(h.orgId, "zh.md", "中文说明"))).toBe("中文说明");
    h.connection.close();
  });

  test("refuses blocked files, unknown ids, and other companies' files", () => {
    const h = harness();
    expect(h.read(h.addFile(h.orgId, "virus.txt", "bad", "blocked"))).toBe("ERROR: virus.txt was blocked by the file scan and cannot be read.");
    expect(h.read("fil_missing")).toBe('ERROR: No file with file_id "fil_missing".');
    const foreign = h.addFile(h.otherOrgId, "secret.md", "other company");
    expect(h.read(foreign)).toBe(`ERROR: No file with file_id "${foreign}".`);
    h.connection.close();
  });
});
