import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { canonicalMentionHandle } from "../../src/shared/mention-handles";
import { dispatchAgentTool, type AgentToolContext } from "../../src/main/services/agent-tools";

function call(name: string, args: Record<string, unknown>) {
  return { id: `call_${randomUUID()}`, name, arguments: args };
}

describe("mention resolution", () => {
  test("canonicalMentionHandle strips spaces and lowercases", () => {
    expect(canonicalMentionHandle("Sarah Chen")).toBe("sarahchen");
    expect(canonicalMentionHandle("J.P. Morgan")).toBe("jpmorgan");
    expect(canonicalMentionHandle("alice")).toBe("alice");
  });

  test("@mention with canonical handle resolves to multi-word agent name", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-mention-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    let ceoId = "";
    let providerId = "";
    let engineerId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "TestCorp", employeeName: "Yang", mission: "m", goal: "g" });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      ceoId = organization.createAgent({
        orgId, name: "Alex Kim", role: "CEO", department: "Executive",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null,
      });
      engineerId = organization.createAgent({
        orgId, name: "Sarah Chen", role: "Engineer", department: "Engineering",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 10000, managerAgentId: ceoId,
      });
    });

    const handle = canonicalMentionHandle("Sarah Chen");
    expect(handle).toBe("sarahchen");

    const deps = { db: connection.db, organization, chat: new ChatService(connection.db) };
    const ctx: AgentToolContext = {
      orgId, agent: { id: ceoId, modelProviderId: providerId, modelId: "gpt-5.4" },
      taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: null,
    };

    const result = dispatchAgentTool(deps, ctx, call("send_message", {
      channel: "engineering",
      body: `@${handle} can you review this?`,
    }));
    expect(result).toContain("Sarah Chen");

    const mentions = connection.db.prepare(
      "select target_type, target_id, wake_state from chat_mentions where target_type = 'agent' and target_id = ?",
    ).all(engineerId) as Array<{ target_type: string; target_id: string; wake_state: string }>;
    expect(mentions.length).toBeGreaterThan(0);
    expect(mentions[0].target_id).toBe(engineerId);
  });

  test("read_messages returns recent channel messages", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-read-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    let ceoId = "";
    let providerId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "ReadCorp", employeeName: "Yang", mission: "m", goal: "g" });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      ceoId = organization.createAgent({
        orgId, name: "CEO", role: "CEO", department: "Executive",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null,
      });
    });

    const deps = { db: connection.db, organization, chat: new ChatService(connection.db) };
    const ctx: AgentToolContext = {
      orgId, agent: { id: ceoId, modelProviderId: null, modelId: null },
      taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: null,
    };

    dispatchAgentTool(deps, ctx, call("send_message", { channel: "general", body: "Hello team!" }));
    dispatchAgentTool(deps, ctx, call("send_message", { channel: "general", body: "Kickoff meeting at 3pm." }));

    const readResult = dispatchAgentTool(deps, ctx, call("read_messages", { channel: "general" }));
    expect(readResult).toContain("Hello team!");
    expect(readResult).toContain("Kickoff meeting at 3pm.");
  });

  test("read_messages with no channel returns agent mentions", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-inbox-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    let ceoId = "";
    let engineerId = "";
    let providerId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "InboxCorp", employeeName: "Yang", mission: "m", goal: "g" });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      ceoId = organization.createAgent({
        orgId, name: "CEO", role: "CEO", department: "Executive",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null,
      });
      engineerId = organization.createAgent({
        orgId, name: "Dana", role: "Engineer", department: "Engineering",
        modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: ceoId,
      });
    });

    const deps = { db: connection.db, organization, chat: new ChatService(connection.db) };
    const ceoCtx: AgentToolContext = {
      orgId, agent: { id: ceoId, modelProviderId: null, modelId: null },
      taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: null,
    };

    dispatchAgentTool(deps, ceoCtx, call("send_message", { channel: "engineering", body: "@dana check the deployment" }));

    const danaCtx: AgentToolContext = {
      orgId, agent: { id: engineerId, modelProviderId: null, modelId: null },
      taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: null,
    };
    const inbox = dispatchAgentTool(deps, danaCtx, call("read_messages", {}));
    expect(inbox).toContain("check the deployment");

    // Once Dana answers in that thread, the mention is handled and leaves her inbox.
    const threadId = /thread=([^)]+)\)/.exec(inbox)?.[1];
    expect(threadId).toBeTruthy();
    dispatchAgentTool(deps, danaCtx, call("send_message", { channel: "engineering", body: "Deployment checked.", thread_id: threadId }));
    expect(dispatchAgentTool(deps, danaCtx, call("read_messages", {}))).toBe("No unanswered mentions.");

    dispatchAgentTool(deps, ceoCtx, call("send_message", { channel: "engineering", body: "@dana one more: ship it", thread_id: threadId }));
    const next = dispatchAgentTool(deps, danaCtx, call("read_messages", {}));
    expect(next).toContain("ship it");
    expect(next).not.toContain("check the deployment");

    // A mention added later by editing an old message is unanswered again.
    dispatchAgentTool(deps, ceoCtx, call("send_message", { channel: "engineering", body: "status?", thread_id: threadId }));
    const plainId = (connection.db.prepare("select id from chat_messages where body_md = 'status?'").get() as { id: string }).id;
    dispatchAgentTool(deps, danaCtx, call("send_message", { channel: "engineering", body: "All good.", thread_id: threadId }));
    deps.chat.editMessage({ orgId, messageId: plainId, bodyMd: "@dana status on the rollback?", actorType: "agent", actorId: ceoId });
    expect(dispatchAgentTool(deps, danaCtx, call("read_messages", {}))).toContain("status on the rollback");
  });
});

describe("read_messages history access", () => {
  test("reads one thread, pages back with before, and searches with query", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-history-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    let ceoId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "HistCorp", employeeName: "Yang", mission: "m", goal: "g" });
      const providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      ceoId = organization.createAgent({
        orgId, name: "CEO", role: "CEO", department: "Executive",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null,
      });
    });
    const deps = { db: connection.db, organization, chat: new ChatService(connection.db) };
    const ctx: AgentToolContext = {
      orgId, agent: { id: ceoId, modelProviderId: null, modelId: null },
      taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: null,
    };
    const first = dispatchAgentTool(deps, ctx, call("send_message", { channel: "general", body: "Decision 0: use Postgres" }));
    const threadId = /thread_id="([^"]+)"/.exec(first)![1];
    for (let index = 1; index <= 14; index += 1) {
      dispatchAgentTool(deps, ctx, call("send_message", { channel: "general", body: `Decision ${index}`, thread_id: threadId }));
    }
    dispatchAgentTool(deps, ctx, call("send_message", { channel: "general", body: "Unrelated chatter" }));
    connection.db.prepare("update chat_messages set created_at = '2026-01-01T00:00:' || printf('%02d', rowid) || '.000Z'").run();

    const page = dispatchAgentTool(deps, ctx, call("read_messages", { thread_id: threadId, limit: 5 }));
    expect(page).not.toContain("Unrelated chatter");
    expect(page).toContain("Decision 14");
    expect(page).not.toContain("Decision 9");
    const before = /before="([^"]+)"/.exec(page)![1];
    const older = dispatchAgentTool(deps, ctx, call("read_messages", { thread_id: threadId, limit: 5, before }));
    expect(older).toContain("Decision 9");
    expect(older).not.toContain("Decision 10");

    const found = dispatchAgentTool(deps, ctx, call("read_messages", { channel: "general", query: "postgres" }));
    expect(found).toContain("Decision 0: use Postgres");
    expect(found).not.toContain("Decision 1");
    expect(dispatchAgentTool(deps, ctx, call("read_messages", { thread_id: threadId, channel: "general" }))).toContain('Pass only one of');
    for (const bad of ["yesterday", "2026-02-30T00:00:00.000Z", "2026-01-01 00:00:00", "2026-01-01T00:00:00+08:00"]) {
      expect(dispatchAgentTool(deps, ctx, call("read_messages", { channel: "general", before: bad }))).toContain('"before" must be a message_id from a previous page or a UTC ISO timestamp');
    }
    expect(dispatchAgentTool(deps, ctx, call("read_messages", { thread_id: threadId, before: "2026-01-01T00:00:03Z" }))).toContain("Decision 1");

    // Messages sharing one timestamp still page through completely.
    connection.db.prepare("update chat_messages set created_at = '2026-01-01T00:00:00.000Z' where thread_id = ?").run(threadId);
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let pageIndex = 0; pageIndex < 5; pageIndex += 1) {
      const result = dispatchAgentTool(deps, ctx, call("read_messages", { thread_id: threadId, limit: 4, ...(cursor ? { before: cursor } : {}) }));
      for (const match of result.matchAll(/: (Decision \d+)/g)) seen.add(match[1].split(":")[0]);
      cursor = /before="([^"]+)"/.exec(result)?.[1];
      if (!cursor) break;
    }
    expect(seen.size).toBe(15);
    connection.close();
  });
});
