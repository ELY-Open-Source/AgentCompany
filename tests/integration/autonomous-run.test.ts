import { existsSync, mkdirSync, readFileSync } from "node:fs";
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
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { claimNextQueuedRun } from "../../src/main/app/task-queue-worker";
import type { AgentTurnMessage, AgentTurnResult, ProviderToolTurnInput, ToolCall } from "../../src/main/services/provider-tool-turn";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: `call_${randomUUID()}`, name, arguments: args };
}

/** Scripts the CEO: staff two reports, delegate work, hand off the file in chat, close the kickoff, then stop. */
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
    { text: "Handing off the plan.", toolCalls: [] },
    { text: "Closing the kickoff.", toolCalls: [] },
    { text: "Team staffed, work delegated, plan written.", toolCalls: [] },
  ];
  let index = 0;
  return async (input) => {
    const fileId = lastToolOutput(input.messages, "write_deliverable").match(/file_id=([^),\s]+)/)?.[1];
    if (fileId && index === 3) {
      index += 1;
      return {
        text: "Handing off the plan.",
        toolCalls: [
          call("send_message", {
            channel: "general",
            body: "/handoff @Mara-Quinn operating plan for booking-site execution. @Owen-Diaz coordinate launch operations in this thread.",
            attachment_file_ids: [fileId],
          }),
        ],
        rawResponseJson: JSON.stringify({ id: `resp_${index}` }),
      };
    }
    if (index === 4) {
      // The prompt carries the task id so the agent can actually close its task.
      const firstUser = input.messages.find((message) => message.role === "user");
      const taskId = firstUser ? /Task id: (\S+)/.exec(firstUser.text)?.[1] : undefined;
      index += 1;
      return {
        text: "Closing the kickoff.",
        toolCalls: taskId ? [call("update_task_status", { task_id: taskId, status: "done" })] : [],
        rawResponseJson: JSON.stringify({ id: `resp_${index}` }),
      };
    }
    const turn = script[index] ?? { text: "done", toolCalls: [] };
    index += 1;
    return { text: turn.text, toolCalls: turn.toolCalls, rawResponseJson: JSON.stringify({ id: `resp_${index}` }) };
  };
}

function lastToolOutput(messages: AgentTurnMessage[], toolName: string): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "tool") continue;
    const result = message.results.find((item) => item.toolName === toolName);
    if (result) return result.output;
  }
  return "";
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

    // The deliverable is registered as a file object owned by the writing agent,
    // so it appears on the Files page (previously it only existed on disk).
    const ceo = state.agents.find((a) => a.orgId === orgId && a.name === "CEO");
    const planFile = state.files.find((f) => f.orgId === orgId && f.name === "operating-plan.md");
    expect(planFile).toBeTruthy();
    expect(planFile).toMatchObject({ ownerType: "agent", ownerId: ceo?.id, kind: "md", scanState: "approved" });

    // The CEO posts a file handoff in the company channel, so chat carries the
    // actual artifact and recipient mentions instead of a plain status note.
    const general = state.chatSpaces.find((s) => s.orgId === orgId && s.name === "general");
    const kickoff = state.chatMessages.find((m) => m.orgId === orgId && m.spaceId === general?.id && m.bodyMd.includes("/handoff"));
    expect(kickoff).toMatchObject({ senderType: "agent", senderId: ceo?.id });
    expect(kickoff?.bodyMd).toContain("/handoff @Mara-Quinn");
    expect(state.chatAttachments).toContainEqual(expect.objectContaining({ messageId: kickoff?.id, fileId: planFile?.id }));
    expect(state.chatMentions).toEqual(expect.arrayContaining([
      expect.objectContaining({ messageId: kickoff?.id, targetType: "agent", targetId: mara?.id }),
      expect.objectContaining({ messageId: kickoff?.id, targetType: "agent", targetId: state.agents.find((a) => a.orgId === orgId && a.name === "Owen Diaz")?.id }),
    ]));
    expect(state.fileHandoffRecords).toContainEqual(expect.objectContaining({
      messageId: kickoff?.id,
      fileId: planFile?.id,
      targetPrincipalType: "agent",
      targetPrincipalId: mara?.id,
      policyDecision: "approved_for_handoff",
    }));

    const run = state.taskRuns.find((r) => r.id === claimed!.id);
    expect(run?.state).toBe("completed");

    // The CEO closed the kickoff task using the task id the prompt carries.
    const kickoffTask = connection.db.prepare("select status from tasks where id = (select task_id from task_runs where id = ?)")
      .get(claimed!.id) as { status: string };
    expect(kickoffTask).toEqual({ status: "done" });

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

  test("a goal created after onboarding reaches the CEO and runs autonomously", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-goal-${randomUUID()}.db`));
    // A minimal well-behaved agent: does its session, closes its task, then stops.
    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, async (input: ProviderToolTurnInput) => {
      const firstUser = input.messages.find((message) => message.role === "user");
      const taskId = firstUser && firstUser.role === "user" ? /Task id: (\S+)/.exec(firstUser.text)?.[1] : undefined;
      const alreadyClosed = input.messages.some(
        (message) => message.role === "tool" && message.results.some((result) => result.toolName === "update_task_status"),
      );
      if (taskId && !alreadyClosed) {
        return {
          text: "Reviewed the goal; closing the kickoff.",
          toolCalls: [call("update_task_status", { task_id: taskId, status: "done" })],
          rawResponseJson: JSON.stringify({ id: "resp_goal_close" }),
        };
      }
      return {
        text: "Reviewed the goal and posted the operating plan.",
        toolCalls: [],
        rawResponseJson: JSON.stringify({ id: "resp_goal" }),
      };
    });
    const onboarding = new OnboardingService({ db: connection.db, saveProviderCredential: (input) => providers.saveCredential(input) });
    const organization = new OrganizationService(connection.db);
    const taskExecution = new TaskExecutionService(connection.db, providers);

    let orgId = "";
    let ceoAgentId = "";
    connection.transaction(() => {
      const summary = onboarding.bootstrap({
        companyName: "OrbitOps AI",
        companyDescription: "AI-run operations company.",
        employeeName: "Yang",
        workspacePath: "",
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
      ceoAgentId = summary.ceoAgentId;
    });

    // Drain the bootstrap kickoff so only the new goal's work remains.
    const bootstrapRun = claimNextQueuedRun(connection);
    await taskExecution.executeRun(bootstrapRun!.org_id, bootstrapRun!.id);

    let goalId = "";
    connection.transaction(() => {
      goalId = organization.createGoal({
        orgId,
        title: "Open the Berlin market",
        description: "Win the first ten customers.",
        ownerAgentId: null,
      });
    });

    const kickoff = connection.db.prepare("select id, assignee_agent_id, status from tasks where goal_id = ?")
      .get(goalId) as { id: string; assignee_agent_id: string; status: string };
    expect(kickoff.assignee_agent_id).toBe(ceoAgentId);
    expect(kickoff.status).toBe("backlog");

    // The autonomous worker's heartbeat picks the kickoff up and completes it.
    const enqueued = connection.transaction(() => taskExecution.enqueueHeartbeatRuns());
    expect(enqueued).toHaveLength(1);
    const claimed = claimNextQueuedRun(connection);
    expect(claimed?.id).toBe(enqueued[0]);
    await taskExecution.executeRun(claimed!.org_id, claimed!.id);
    const run = connection.db.prepare("select state, task_id, trigger from task_runs where id = ?")
      .get(claimed!.id) as { state: string; task_id: string; trigger: string };
    expect(run).toMatchObject({ state: "completed", task_id: kickoff.id, trigger: "heartbeat" });
    connection.close();
  });
});
