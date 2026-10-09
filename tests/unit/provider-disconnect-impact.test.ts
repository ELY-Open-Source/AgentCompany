import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { providerDisconnectImpact } from "../../src/main/services/provider-disconnect-impact";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS } from "../../src/shared/domain";

describe("what disconnecting a provider affects", () => {
  test("names its agents, their open tasks, and the sessions that stop or will fail", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-disconnect-${randomUUID()}.db`));
    const db = connection.db;
    const organization = new OrganizationService(db);
    let orgId = "";
    let openai = "";
    let ada = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Yang", mission: "m", goal: "g" });
      const idOf = (key: string) => (db.prepare("select id from providers where org_id = ? and provider_key = ?").get(orgId, key) as { id: string }).id;
      openai = idOf("openai");
      ada = organization.createAgent({ orgId, name: "Ada", role: "Engineer", department: "Engineering", modelProviderId: openai, modelId: null, budgetCents: 1000, managerAgentId: null });
      organization.createAgent({ orgId, name: "Bo", role: "Writer", department: "Engineering", modelProviderId: idOf("anthropic"), modelId: null, budgetCents: 1000, managerAgentId: null });
    });
    const task = (title: string, status: string) => organization.createTask({
      orgId, title, description: "d", status: status as (typeof TASK_STATUS)[keyof typeof TASK_STATUS], assigneeAgentId: ada, risk: RISK_LEVEL.LOW,
      projectId: null, goalId: null, workspaceId: null, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: false,
    });
    const open = task("Open", TASK_STATUS.BACKLOG);
    task("Finished", TASK_STATUS.DONE);
    const run = (id: string, state: string) => db.prepare("insert into task_runs(id, org_id, task_id, agent_id, provider_id, trigger, state, created_at) values (?, ?, ?, ?, ?, 'manual', ?, ?)")
      .run(id, orgId, open, ada, openai, state, new Date().toISOString());
    run("run_a", "queued");
    run("run_b", "running");
    run("run_c", "completed");

    expect(providerDisconnectImpact(db, orgId, openai)).toEqual({ agents: ["Ada"], openTasks: 1, runningRuns: 1, queuedRuns: 1 });
    expect(() => providerDisconnectImpact(db, orgId, "prv_missing")).toThrow("Provider was not found.");
  });
});
