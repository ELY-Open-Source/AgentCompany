import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { CHAT_WAKE_TTL_MS, expireStaleChatWakes } from "../../src/main/services/chat-agent-wake-service";

interface Harness {
  connection: DatabaseConnection;
  chat: ChatService;
  orgId: string;
  employeeId: string;
  ceoId: string;
  danaId: string;
}

function harness(): Harness {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-wake-expiry-${randomUUID()}.db`));
  const organization = new OrganizationService(connection.db);
  let orgId = "";
  let ceoId = "";
  let danaId = "";
  connection.transaction(() => {
    orgId = organization.createOrganization({ organizationName: "OrbitOps", employeeName: "Yang", mission: "m", goal: "g" });
    const providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
    connection.db.prepare("update providers set enabled = 1 where id = ? and org_id = ?").run(providerId, orgId);
    ceoId = organization.createAgent({
      orgId, name: "CEO", role: "CEO", department: "Executive",
      modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null, roleLevel: "c_suite",
    });
    danaId = organization.createAgent({
      orgId, name: "Dana", role: "Engineer", department: "Engineering",
      modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 1000, managerAgentId: ceoId,
    });
  });
  const employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
  return { connection, chat: new ChatService(connection.db), orgId, employeeId, ceoId, danaId };
}

/** DM an agent as the founder, returning the woken run id. */
function wake(h: Harness, agentId: string): string {
  const spaceId = h.chat.ensureDirectSpace(h.orgId, { type: "employee", id: h.employeeId }, { type: "agent", id: agentId });
  h.chat.sendMessage({
    orgId: h.orgId, spaceId, threadId: null, senderType: "employee", senderId: h.employeeId,
    bodyMd: "ping", attachmentFileIds: [],
  });
  const run = h.connection.db.prepare(
    "select id from task_runs where org_id = ? and agent_id = ? and trigger = 'chat_mention' and state = 'queued'",
  ).get(h.orgId, agentId) as { id: string };
  return run.id;
}

function runRow(h: Harness, runId: string): { state: string; error_message: string | null; task_status: string } {
  return h.connection.db.prepare(`
    select r.state, r.error_message, t.status as task_status
    from task_runs r join tasks t on t.id = r.task_id
    where r.id = ?
  `).get(runId) as { state: string; error_message: string | null; task_status: string };
}

describe("stale chat wakes expire", () => {
  test("a wake queued past the TTL is expired with its vehicle task; fresh wakes survive", () => {
    const h = harness();
    const staleRunId = wake(h, h.danaId);
    const freshRunId = wake(h, h.ceoId);
    const now = new Date();
    const beyondTtl = new Date(now.getTime() - CHAT_WAKE_TTL_MS - 60_000).toISOString();
    h.connection.db.prepare("update task_runs set created_at = ? where id = ?").run(beyondTtl, staleRunId);

    const expired = h.connection.transaction(() => expireStaleChatWakes(h.connection.db, now.toISOString()));
    expect(expired).toBe(1);

    const stale = runRow(h, staleRunId);
    expect(stale.state).toBe("failed");
    expect(stale.error_message).toContain("Expired");
    expect(stale.task_status).toBe("done");

    const fresh = runRow(h, freshRunId);
    expect(fresh.state).toBe("queued");
    expect(fresh.task_status).toBe("backlog");

    // Idempotent: nothing left to expire.
    expect(h.connection.transaction(() => expireStaleChatWakes(h.connection.db, now.toISOString()))).toBe(0);
    h.connection.close();
  });

  test("real work is never expired: heartbeat and kickoff runs outlive any queue age", () => {
    const h = harness();
    // The bootstrap-style run: a plain queued run with a non-chat trigger.
    const staleRunId = wake(h, h.danaId);
    h.connection.db.prepare("update task_runs set trigger = 'heartbeat', created_at = '2026-01-01T00:00:00Z' where id = ?").run(staleRunId);

    expect(h.connection.transaction(() => expireStaleChatWakes(h.connection.db, new Date().toISOString()))).toBe(0);
    expect((h.connection.db.prepare("select state from task_runs where id = ?").get(staleRunId) as { state: string }).state).toBe("queued");
    h.connection.close();
  });
});
