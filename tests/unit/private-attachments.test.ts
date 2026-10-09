import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

vi.mock("electron", () => ({ dialog: {}, shell: {} }));

const { DatabaseConnection } = await import("../../src/main/database/connection");
const { OrganizationService } = await import("../../src/main/services/organization-service");
const { ChatService } = await import("../../src/main/services/chat-service");
const { FileService } = await import("../../src/main/services/file-service");
const { dispatchAgentTool } = await import("../../src/main/services/agent-tools");

describe("files shared in a private conversation", () => {
  test("a file imported into a direct conversation is readable by its members only", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-private-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    const chat = new ChatService(connection.db);
    let orgId = "";
    let danaId = "";
    let eveId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Yang", mission: "m", goal: "g" });
      const providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      connection.db.prepare("update providers set enabled = 1 where id = ?").run(providerId);
      danaId = organization.createAgent({ orgId, name: "Dana", role: "Engineer", department: "Engineering", modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 1000, managerAgentId: null });
      eveId = organization.createAgent({ orgId, name: "Eve", role: "Engineer", department: "Engineering", modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 1000, managerAgentId: null });
    });
    const employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
    const dm = connection.transaction(() => chat.ensureDirectSpace(orgId, { type: "employee", id: employeeId }, { type: "agent", id: danaId }));
    const source = join(tmpdir(), `ac-private-src-${randomUUID()}`);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "salary.md"), "Dana's raise: 10%");
    const artifacts = join(tmpdir(), `ac-private-art-${randomUUID()}`);
    const fileId = await new FileService(connection.db, artifacts).importPath(orgId, join(source, "salary.md"), dm);

    const deps = { db: connection.db, organization, chat };
    const as = (agentId: string) => ({ orgId, agent: { id: agentId, modelProviderId: null, modelId: null }, taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: null });
    expect(dispatchAgentTool(deps, as(danaId), { id: "c1", name: "read_attachment", arguments: { file_id: fileId } })).toContain("Dana's raise");
    expect(dispatchAgentTool(deps, as(eveId), { id: "c2", name: "read_attachment", arguments: { file_id: fileId } }))
      .toBe("ERROR: You have no access to salary.md; it was shared in a conversation you are not part of.");
    expect(dispatchAgentTool(deps, as(eveId), { id: "c3", name: "create_task", arguments: { title: "Leak", description: "d", input_file_ids: [fileId] } }))
      .toBe("ERROR: You have no access to salary.md; it was shared in a conversation you are not part of.");
    // A member cannot hand the file on to someone outside the conversation either.
    expect(dispatchAgentTool(deps, as(danaId), { id: "c4", name: "create_task", arguments: { title: "Pass on", description: "d", assignee_agent_name: "Eve", input_file_ids: [fileId] } }))
      .toBe("ERROR: Eve has no access to salary.md; it was shared in a conversation they are not part of. Share it with them or assign someone who has it.");
    expect(connection.db.prepare("select count(*) as n from tasks where title in ('Leak', 'Pass on')").get()).toEqual({ n: 0 });
    expect(connection.db.prepare("select granted_to_type as type from file_access_grants where file_id = ? order by granted_to_type").all(fileId))
      .toEqual([{ type: "agent" }, { type: "employee" }]);
    connection.close();
  });

  test("a file over the import limit is refused before anything is copied", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-import-limit-${randomUUID()}.db`));
    let orgId = "";
    connection.transaction(() => {
      orgId = new OrganizationService(connection.db).createOrganization({ organizationName: "Acme", employeeName: "Yang", mission: "m", goal: "g" });
    });
    const huge = join(tmpdir(), `ac-huge-${randomUUID()}.bin`);
    writeFileSync(huge, "");
    truncateSync(huge, 1024 * 1024 * 1024 + 1);
    const artifacts = join(tmpdir(), `ac-import-limit-art-${randomUUID()}`);
    await expect(new FileService(connection.db, artifacts).importPath(orgId, huge, null)).rejects.toThrow("files over 1024.0 MiB cannot be imported");
    expect(readdirSync(artifacts, { recursive: true })).toEqual([]);
    rmSync(huge);
    connection.close();
  });
});
