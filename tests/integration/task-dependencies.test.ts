import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OnboardingService } from "../../src/main/services/onboarding-service";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { TaskExecutionService } from "../../src/main/services/task-execution-service";
import { ChatService } from "../../src/main/services/chat-service";
import { dispatchAgentTool } from "../../src/main/services/agent-tools";
import { claimNextQueuedRun } from "../../src/main/app/task-queue-worker";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS } from "../../src/shared/domain";
import type { AgentTurnResult, ProviderToolTurnInput } from "../../src/main/services/provider-tool-turn";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

function company() {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-deps-${randomUUID()}.db`));
  const prompts: string[] = [];
  const turn = async (input: ProviderToolTurnInput): Promise<AgentTurnResult> => {
    const first = input.messages[0];
    if (first?.role !== "user") throw new Error("The run must open with the task prompt.");
    prompts.push(first.text);
    return { text: "done", toolCalls: [], rawResponseJson: "{}" };
  };
  const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, turn);
  const onboarding = new OnboardingService({ db: connection.db, saveProviderCredential: (input) => providers.saveCredential(input) });
  const execution = new TaskExecutionService(connection.db, providers);
  const organization = new OrganizationService(connection.db);
  let orgId = "";
  let ceoId = "";
  connection.transaction(() => {
    const summary = onboarding.bootstrap({
      companyName: "FlowPilot", companyDescription: "CSM analytics.", employeeName: "Yang", workspacePath: "",
      executionMode: "ai_ceo", autoApproveHires: true, reviewDeliverables: false,
      goalTitle: "Ship the MVP.", goalDescription: "A working product.",
      providerKey: "openai", providerSecret: "sk-test-key", providerModel: "gpt-5.4",
    });
    orgId = summary.orgId;
    ceoId = summary.ceoAgentId;
  });
  return { connection, execution, organization, orgId, ceoId, prompts };
}

describe("task dependencies", () => {
  test("a parent cannot close while subtasks are open, and waits for them before running again", async () => {
    const h = company();
    const { prompts } = h;
    const kickoff = claimNextQueuedRun(h.connection)!;
    const parentId = (h.connection.db.prepare("select task_id from task_runs where id = ?").get(kickoff.id) as { task_id: string }).task_id;
    await h.execution.executeRun(h.orgId, kickoff.id);
    const childId = h.organization.createTask({
      orgId: h.orgId, title: "Hire the CTO", description: "d", status: TASK_STATUS.BACKLOG, assigneeAgentId: h.ceoId,
      risk: RISK_LEVEL.LOW, projectId: null, goalId: null, workspaceId: null, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: false,
    });
    h.connection.db.prepare("update tasks set parent_task_id = ? where id = ?").run(parentId, childId);

    const parentTitle = (h.connection.db.prepare("select title from tasks where id = ?").get(parentId) as { title: string }).title;
    expect(() => h.organization.updateTaskStatus(h.orgId, parentId, TASK_STATUS.DONE))
      .toThrow(`"${parentTitle}" has open subtasks: Hire the CTO. It can close once they are done.`);
    const ctx = { orgId: h.orgId, agent: { id: h.ceoId, modelProviderId: null, modelId: null }, taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: null };
    const deps = { db: h.connection.db, organization: h.organization, chat: new ChatService(h.connection.db) };
    expect(dispatchAgentTool(deps, ctx, { id: "c1", name: "update_task_status", arguments: { task_id: parentId, status: "done" } }))
      .toBe(`ERROR: "${parentTitle}" has open subtasks: Hire the CTO. It can close once they are done.`);

    // A run queued before the subtask existed is superseded instead of running ahead of it.
    h.connection.db.prepare("insert into task_runs(id, org_id, task_id, agent_id, provider_id, execution_context_id, service_identity_id, workspace_mount_json, secret_scope_json, trigger, state, created_at) select 'run_early', org_id, task_id, agent_id, provider_id, 'ctx_early', service_identity_id, workspace_mount_json, secret_scope_json, 'heartbeat', 'running', created_at from task_runs where id = ?").run(kickoff.id);
    await h.execution.executeRun(h.orgId, "run_early");
    expect(h.connection.db.prepare("select state, error_message from task_runs where id = 'run_early'").get())
      .toEqual({ state: "superseded", error_message: 'Superseded: the task has open subtasks ("Hire the CTO"); it runs again once they are done.' });

    const waiting = h.connection.transaction(() => h.execution.enqueueHeartbeatRuns());
    const queuedTasks = () => (h.connection.db.prepare("select task_id from task_runs where state = 'queued'").all() as Array<{ task_id: string }>).map((row) => row.task_id);
    expect(waiting).toHaveLength(1);
    expect(queuedTasks()).toEqual([childId]);

    h.connection.db.prepare("update task_runs set state = 'completed' where state = 'queued'").run();
    h.organization.updateTaskStatus(h.orgId, childId, TASK_STATUS.DONE);
    h.connection.transaction(() => h.execution.enqueueHeartbeatRuns());
    expect(queuedTasks()).toEqual([parentId]);
    const resumed = claimNextQueuedRun(h.connection)!;
    await h.execution.executeRun(h.orgId, resumed.id);
    expect(prompts.at(-1)).toContain("The subtasks you delegated from this task are all done: Hire the CTO.");
    expect(prompts[0]).toContain('move it to "in_progress"');
    expect(prompts[0]).not.toContain(`update_task_status(task_id="${parentId}", status="done") and summarize`);
    h.organization.updateTaskStatus(h.orgId, parentId, TASK_STATUS.DONE);
    h.connection.close();
  });
});
