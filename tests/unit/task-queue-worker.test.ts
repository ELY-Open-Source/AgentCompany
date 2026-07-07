import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS } from "../../src/shared/domain";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { claimNextQueuedRun } from "../../src/main/app/task-queue-worker";

function seedQueuedRun(connection: DatabaseConnection, orgId: string, taskId: string, agentId: string, providerId: string): string {
  const runId = `run_${randomUUID()}`;
  connection.db.prepare(`
    insert into task_runs(
      id, org_id, task_id, agent_id, provider_id, provider_request_id,
      execution_context_id, service_identity_id, workspace_mount_json, secret_scope_json,
      trigger, state, created_at, started_at, completed_at, error_message
    ) values (?, ?, ?, ?, ?, null, ?, null, '[]', '{}', 'bootstrap', 'queued', datetime('now'), null, null, null)
  `).run(runId, orgId, taskId, agentId, providerId, `ctx_${randomUUID()}`);
  return runId;
}

describe("task queue worker claim", () => {
  test("claims queued runs once each, in order, then returns null", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-queue-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    let agentId = "";
    let providerId = "";
    let taskId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      agentId = organization.createAgent({ orgId, name: "CEO", role: "CEO", department: "Executive", modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null });
      taskId = organization.createTask({
        orgId, title: "Kickoff", description: "Start.", status: TASK_STATUS.BACKLOG, assigneeAgentId: agentId,
        risk: RISK_LEVEL.LOW, projectId: null, goalId: null, workspaceId: null, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: false,
      });
    });
    const first = seedQueuedRun(connection, orgId, taskId, agentId, providerId);
    const second = seedQueuedRun(connection, orgId, taskId, agentId, providerId);

    const claimedA = claimNextQueuedRun(connection);
    const claimedB = claimNextQueuedRun(connection);
    const claimedC = claimNextQueuedRun(connection);

    expect([claimedA?.id, claimedB?.id].sort()).toEqual([first, second].sort());
    expect(claimedC).toBeNull();

    const states = (connection.db.prepare("select state from task_runs where org_id = ? order by created_at").all(orgId) as Array<{ state: string }>).map((r) => r.state);
    expect(states).toEqual(["running", "running"]);
    connection.close();
  });
});
