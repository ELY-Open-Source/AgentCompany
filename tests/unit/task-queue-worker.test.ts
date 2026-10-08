import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { mkdirSync, symlinkSync } from "node:fs";
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
    // One session per agent: the second run waits while the first is running.
    expect(claimNextQueuedRun(connection)).toBeNull();
    connection.db.prepare("update task_runs set state = 'completed' where id = ?").run(claimedA!.id);
    const claimedB = claimNextQueuedRun(connection);
    const claimedC = claimNextQueuedRun(connection);

    expect([claimedA?.id, claimedB?.id].sort()).toEqual([first, second].sort());
    expect(claimedC).toBeNull();

    const states = (connection.db.prepare("select state from task_runs where org_id = ? order by created_at").all(orgId) as Array<{ state: string }>).map((r) => r.state).sort();
    expect(states).toEqual(["completed", "running"]);
    connection.close();
  });

  test("leaves runs of a cooling-down provider queued instead of claiming them", () => {
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
    const runId = seedQueuedRun(connection, orgId, taskId, agentId, providerId);

    expect(claimNextQueuedRun(connection, [providerId])).toBeNull();
    expect(connection.db.prepare("select state from task_runs where id = ?").get(runId)).toEqual({ state: "queued" });

    expect(claimNextQueuedRun(connection, [])?.id).toBe(runId);
    connection.close();
  });
});

describe("one writing run per workspace", () => {
  test("a second write-granted run in the same workspace waits; read-only work proceeds", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-queue-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    let providerId = "";
    const agents: string[] = [];
    const tasks: string[] = [];
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      const workspaceId = organization.createWorkspace({ orgId, name: "repo", localPath: tmpdir(), projectId: null });
      for (const [name, writes] of [["Ana", true], ["Ben", true], ["Cy", false]] as const) {
        const agentId = organization.createAgent({ orgId, name, role: "Engineer", department: "Engineering", modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 1000, managerAgentId: null });
        agents.push(agentId);
        tasks.push(organization.createTask({
          orgId, title: `${name} work`, description: "d", status: TASK_STATUS.BACKLOG, assigneeAgentId: agentId,
          risk: RISK_LEVEL.LOW, projectId: null, goalId: null, workspaceId, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: writes,
        }));
      }
    });
    const runs = tasks.map((taskId, index) => seedQueuedRun(connection, orgId, taskId, agents[index], providerId));
    connection.db.prepare("update task_runs set created_at = ? where id = ?").run("2026-01-01T00:00:01Z", runs[0]);
    connection.db.prepare("update task_runs set created_at = ? where id = ?").run("2026-01-01T00:00:02Z", runs[1]);
    connection.db.prepare("update task_runs set created_at = ? where id = ?").run("2026-01-01T00:00:03Z", runs[2]);

    expect(claimNextQueuedRun(connection)?.id).toBe(runs[0]);
    expect(claimNextQueuedRun(connection)?.id).toBe(runs[2]);
    expect(claimNextQueuedRun(connection)).toBeNull();
    connection.db.prepare("update task_runs set state = 'completed' where id = ?").run(runs[0]);
    expect(claimNextQueuedRun(connection)?.id).toBe(runs[1]);
    connection.close();
  });
});

describe("workspace write lock follows the directory", () => {
  test("one folder, a junction to it, and nested folders (even not yet created) share the lock", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-queue-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    const root = join(tmpdir(), `ac-repo-${randomUUID()}`);
    mkdirSync(root, { recursive: true });
    const linked = join(tmpdir(), `ac-link-${randomUUID()}`);
    symlinkSync(root, linked, "junction");
    let orgId = "";
    let providerId = "";
    const runs: string[] = [];
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      const paths = [root, linked, `${root}/`, join(root, "packages", "api"), join(linked, "packages", "api", "src")];
      paths.forEach((localPath, index) => {
        const workspaceId = organization.createWorkspace({ orgId, name: `w${index}`, localPath, projectId: null });
        const agentId = organization.createAgent({ orgId, name: `Dev${index}`, role: "Engineer", department: "Engineering", modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 1000, managerAgentId: null });
        const taskId = organization.createTask({
          orgId, title: `t${index}`, description: "d", status: TASK_STATUS.BACKLOG, assigneeAgentId: agentId,
          risk: RISK_LEVEL.LOW, projectId: null, goalId: null, workspaceId, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: true,
        });
        runs.push(seedQueuedRun(connection, orgId, taskId, agentId, providerId));
      });
    });
    runs.forEach((runId, index) => connection.db.prepare("update task_runs set created_at = ? where id = ?").run(`2026-01-01T00:00:0${index}Z`, runId));

    for (const runId of runs) {
      expect(claimNextQueuedRun(connection)?.id).toBe(runId);
      expect(claimNextQueuedRun(connection)).toBeNull();
      connection.db.prepare("update task_runs set state = 'completed' where id = ?").run(runId);
    }
    connection.close();
  });
});
