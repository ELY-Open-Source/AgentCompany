import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OnboardingService } from "../../src/main/services/onboarding-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { TaskExecutionService } from "../../src/main/services/task-execution-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { claimNextQueuedRun } from "../../src/main/app/task-queue-worker";
import type { AgentTurnResult, ProviderToolTurnInput, ToolCall } from "../../src/main/services/provider-tool-turn";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: `call_${randomUUID()}`, name, arguments: args };
}

/** Scripts the CEO: staff two reports, delegate a task, write the plan, then stop. */
function scriptedCeo(): (input: ProviderToolTurnInput) => Promise<AgentTurnResult> {
  const script: Array<{ text: string; toolCalls: ToolCall[] }> = [
    { text: "Staffing.", toolCalls: [
      call("hire_agent", { name: "Mara Quinn", role: "Growth Marketer", department: "Marketing" }),
      call("hire_agent", { name: "Owen Diaz", role: "Operations Lead", department: "Operations" }),
    ] },
    { text: "Delegating.", toolCalls: [
      call("create_task", { title: "Launch the booking site", description: "Ship landing + booking flow.", assignee_agent_name: "Mara Quinn" }),
    ] },
    { text: "Writing the plan.", toolCalls: [
      call("write_deliverable", { path: "plan/operating-plan.md", content: "# OrbitOps Operating Plan\n\n- Validate demand\n- Launch booking site\n" }),
    ] },
    { text: "Team staffed, work delegated, plan written.", toolCalls: [] },
  ];
  let index = 0;
  return async () => {
    const turn = script[index] ?? { text: "done", toolCalls: [] };
    index += 1;
    return { text: turn.text, toolCalls: turn.toolCalls, rawResponseJson: JSON.stringify({ id: `resp_${index}` }) };
  };
}

describe("autonomous bootstrap run", () => {
  test("the queued kickoff run autonomously hires, delegates, and writes a deliverable", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-auto-${randomUUID()}.db`));
    const workspacePath = join(tmpdir(), `ac-auto-ws-${randomUUID()}`);
    mkdirSync(workspacePath, { recursive: true });

    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, scriptedCeo());
    const onboarding = new OnboardingService({ db: connection.db, saveProviderCredential: (input) => providers.saveCredential(input) });
    const snapshot = new SnapshotService(connection.db);

    let orgId = "";
    connection.transaction(() => {
      const summary = onboarding.bootstrap({
        companyName: "OrbitOps AI",
        companyDescription: "AI-run operations company.",
        employeeName: "Yang",
        workspacePath,
        executionMode: "ai_ceo",
        autoApproveHires: true,
        reviewDeliverables: false,
        goalTitle: "Stand up a local service business in 30 days.",
        goalDescription: "Validate the market and win the first paying customers.",
        providerKey: "openai",
        providerSecret: "sk-test-key",
        providerModel: "gpt-5.4",
      });
      orgId = summary.orgId;
    });

    // The bootstrap created exactly one queued run; the worker claims it.
    const claimed = claimNextQueuedRun(connection);
    expect(claimed?.org_id).toBe(orgId);
    expect(claimNextQueuedRun(connection)).toBeNull();

    const taskExecution = new TaskExecutionService(connection.db, providers);
    await taskExecution.executeRun(claimed!.org_id, claimed!.id);

    const state = snapshot.load();
    const agentNames = state.agents.filter((a) => a.orgId === orgId).map((a) => a.name).sort();
    expect(agentNames).toEqual(["CEO", "Mara Quinn", "Owen Diaz"]);

    const delegated = state.tasks.find((t) => t.orgId === orgId && t.title === "Launch the booking site");
    expect(delegated).toBeTruthy();
    const mara = state.agents.find((a) => a.orgId === orgId && a.name === "Mara Quinn");
    expect(delegated?.assigneeAgentId).toBe(mara?.id);

    const deliverable = join(workspacePath, "plan", "operating-plan.md");
    expect(existsSync(deliverable)).toBe(true);
    expect(readFileSync(deliverable, "utf8")).toContain("OrbitOps Operating Plan");

    const run = state.taskRuns.find((r) => r.id === claimed!.id);
    expect(run?.state).toBe("completed");

    // Stage 4 heartbeat: the CEO-delegated task (assigned to a hired, heartbeat-enabled
    // agent, with no run yet) is enqueued exactly once for autonomous execution.
    const enqueued = taskExecution.enqueueHeartbeatRuns();
    expect(enqueued).toHaveLength(1);
    const queued = connection.db.prepare("select task_id, state, trigger from task_runs where id = ?").get(enqueued[0]) as { task_id: string; state: string; trigger: string };
    expect(queued.task_id).toBe(delegated!.id);
    expect(queued.state).toBe("queued");
    expect(queued.trigger).toBe("heartbeat");
    // Idempotent: the delegated task now has a run, so it is not enqueued again.
    expect(taskExecution.enqueueHeartbeatRuns()).toEqual([]);

    connection.close();
  });
});
