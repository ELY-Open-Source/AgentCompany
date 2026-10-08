import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { KnowledgeService } from "../../src/main/services/knowledge-service";
import { dispatchAgentTool, type AgentToolContext } from "../../src/main/services/agent-tools";
import { knowledgeRevisionsSchema } from "../../src/main/database/migrations/064-knowledge-revisions";

describe("knowledge revisions", () => {
  test("a correction keeps the earlier version, the reason, and who changed it", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-revisions-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    let agentId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "R", employeeName: "Y", mission: "m", goal: "g" });
      agentId = organization.createAgent({ orgId, name: "Ana", role: "Analyst", department: "Operations", modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: null });
    });
    const ctx: AgentToolContext = {
      orgId, agent: { id: agentId, modelProviderId: null, modelId: null },
      taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: null,
    };
    const run = (name: string, args: Record<string, unknown>) =>
      dispatchAgentTool({ db: connection.db, organization, chat: new ChatService(connection.db) }, ctx, { id: `c_${randomUUID()}`, name, arguments: args });

    const id = /kne_\w+/.exec(run("record_knowledge", { topic: "Refund window", content: "Refunds within 14 days.", category: "policy" }))![0];
    expect(run("revise_knowledge", { id, content: "Refunds within 30 days.", reason: "Legal confirmed the 30-day rule" })).toBe(`Knowledge entry ${id} is now at revision 2.`);
    expect(connection.db.prepare("select content, topic from knowledge_entries where id = ?").get(id)).toEqual({ content: "Refunds within 30 days.", topic: "Refund window" });

    const history = run("search_knowledge", { id });
    expect(history).toContain(`Knowledge entry ${id} (current), 2 revision(s):`);
    expect(history).toMatch(/r1 .* by agent .* — created\n {2}Refund window \[policy, normal\]: Refunds within 14 days\./);
    expect(history).toMatch(/r2 .* by agent .* — Legal confirmed the 30-day rule\n {2}Refund window \[policy, normal\]: Refunds within 30 days\./);

    expect(run("revise_knowledge", { id, content: "x" })).toBe('ERROR: "reason" is required.');
    expect(run("revise_knowledge", { id: "kne_missing", reason: "r" })).toBe('ERROR: No knowledge entry with id "kne_missing".');

    new KnowledgeService(connection.db).delete({ orgId, entryId: id });
    expect(run("search_knowledge", { id })).toContain(`Knowledge entry ${id} (deleted), 2 revision(s):`);
    connection.close();
  });

  test("the migration gives every existing entry its first revision", () => {
    const db = new DatabaseSync(join(tmpdir(), `ac-revmig-${randomUUID()}.db`));
    db.exec(`
      create table organizations(id text primary key);
      create table schema_migrations(version integer primary key, name text not null, applied_at text not null);
      create table knowledge_entries(id text primary key, org_id text, topic text, category text, content text, importance text, source_type text, source_id text, created_at text);
      insert into organizations values ('org_1');
      insert into knowledge_entries values ('kne_1', 'org_1', 'T', 'fact', 'C', 'normal', 'employee', null, '2026-01-01T00:00:00.000Z');
    `);
    db.exec(knowledgeRevisionsSchema);
    expect(db.prepare("select entry_id, revision, content, reason, created_at from knowledge_revisions").all())
      .toEqual([{ entry_id: "kne_1", revision: 1, content: "C", reason: "created", created_at: "2026-01-01T00:00:00.000Z" }]);
    db.close();
  });
});
