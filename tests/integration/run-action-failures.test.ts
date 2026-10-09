import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OnboardingService } from "../../src/main/services/onboarding-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { recordRunAction, unresolvedActionFailure } from "../../src/main/services/run-journal";
import { TaskExecutionService } from "../../src/main/services/task-execution-service";
import { claimNextQueuedRun } from "../../src/main/app/task-queue-worker";
import type { AgentTurnResult, ProviderToolTurnInput, ToolCall } from "../../src/main/services/provider-tool-turn";
import { answeringModelCheck } from "../helpers/model-check";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

/** A company whose kickoff run makes the given tool calls, one turn each, then ends with a final answer. */
function company(calls: ToolCall[]) {
  let turns = 0;
  const turn = async (_input: ProviderToolTurnInput): Promise<AgentTurnResult> => {
    const call = calls[turns];
    turns += 1;
    return call ? { text: "Working.", toolCalls: [call], rawResponseJson: "{}" } : { text: "All done.", toolCalls: [], rawResponseJson: "{}" };
  };
  const connection = new DatabaseConnection(join(tmpdir(), `ac-action-failures-${randomUUID()}.db`));
  const providers = new ProviderService(connection.db, providerAdapters, testVault, answeringModelCheck(turn));
  const onboarding = new OnboardingService({ db: connection.db, saveProviderCredential: (input) => providers.saveCredential(input) });
  const execution = new TaskExecutionService(connection.db, providers);
  const workspace = join(tmpdir(), `ac-action-failures-ws-${randomUUID()}`);
  mkdirSync(workspace, { recursive: true });
  let orgId = "";
  connection.transaction(() => {
    orgId = onboarding.bootstrap({
      companyName: "FlowPilot", companyDescription: "CSM analytics.", employeeName: "Yang", workspacePath: workspace,
      executionMode: "ai_ceo", autoApproveHires: true, reviewDeliverables: false,
      goalTitle: "Ship the MVP.", goalDescription: "A working product.",
      providerKey: "openai", providerSecret: "sk-test-key", providerModel: "gpt-5.4",
    }).orgId;
  });
  return { connection, execution, orgId, runId: claimNextQueuedRun(connection)!.id };
}

const failingWrite: ToolCall = { id: "c1", name: "write_deliverable", arguments: { path: "../outside.md", content: "x" } };

describe("a run whose actions failed", () => {
  test("does not count as completed when a failed action was never redone", async () => {
    const h = company([failingWrite]);
    await h.execution.executeRun(h.orgId, h.runId);
    const run = h.connection.db.prepare("select state, failure_kind, error_message from task_runs where id = ?").get(h.runId) as { state: string; failure_kind: string; error_message: string };
    // Not a passing provider problem, so it counts against the task's retry budget like any failure.
    expect([run.state, run.failure_kind]).toEqual(["failed", null]);
    expect(run.error_message).toContain("The session ended with 1 failed action it did not redo: write_deliverable");
    h.connection.close();
  });

  test("completes when every failed action was later done successfully", async () => {
    // The tool trims titles, so " Plan " and "Plan" name the same document.
    const broken: ToolCall = { id: "c1", name: "create_document", arguments: { title: " Plan ", doc_type: "plan" } };
    const fixed: ToolCall = { id: "c2", name: "create_document", arguments: { title: "Plan", doc_type: "plan", content: "The plan." } };
    const h = company([broken, fixed]);
    await h.execution.executeRun(h.orgId, h.runId);
    expect(h.connection.db.prepare("select state, failure_kind from task_runs where id = ?").get(h.runId)).toEqual({ state: "completed", failure_kind: null });
    h.connection.close();
  });

  test("a success on a different target does not redo the failed one", async () => {
    const broken: ToolCall = { id: "c1", name: "create_document", arguments: { title: "Required plan", doc_type: "plan" } };
    const other: ToolCall = { id: "c2", name: "create_document", arguments: { title: "Other report", doc_type: "report", content: "Body." } };
    const h = company([broken, other]);
    await h.execution.executeRun(h.orgId, h.runId);
    const run = h.connection.db.prepare("select state, error_message from task_runs where id = ?").get(h.runId) as { state: string; error_message: string };
    expect(run.state).toBe("failed");
    expect(run.error_message).toContain("1 failed action it did not redo: create_document");
    h.connection.close();
  });

  test("a call whose arguments could not be read counts as a failed action", async () => {
    const h = company([{ id: "c1", name: "write_deliverable", arguments: {}, argumentsError: "not valid JSON (Unexpected end): {\"path\":" }]);
    await h.execution.executeRun(h.orgId, h.runId);
    const run = h.connection.db.prepare("select state, error_message from task_runs where id = ?").get(h.runId) as { state: string; error_message: string };
    expect(run.state).toBe("failed");
    expect(run.error_message).toContain("1 failed action it did not redo: write_deliverable (ERROR: not run: the arguments");
    h.connection.close();
  });

  test("a command that exited non-zero is a failure until the same command exits zero", () => {
    const h = company([]);
    const task = h.connection.db.prepare("select task_id from task_runs where id = ?").get(h.runId) as { task_id: string };
    const run = (command: string, output: string) => recordRunAction(h.connection.db, { orgId: h.orgId, runId: h.runId, taskId: task.task_id, call: { id: command, name: "run_command", arguments: { command } }, output });
    run("pnpm test", "exit code 1\n3 failed");
    run("git status", "exit code 0\nclean");
    expect(unresolvedActionFailure(h.connection.db, h.runId)).toBe("The session ended with 1 failed action it did not redo: run_command (exit code 1)");
    run("pnpm test", "exit code 0\nall passed");
    expect(unresolvedActionFailure(h.connection.db, h.runId)).toBeNull();
    h.connection.close();
  });

  test("a connector action on other arguments does not redo the failed one", () => {
    const h = company([]);
    const task = h.connection.db.prepare("select task_id from task_runs where id = ?").get(h.runId) as { task_id: string };
    const update = (issue: number, output: string) => recordRunAction(h.connection.db, {
      orgId: h.orgId, runId: h.runId, taskId: task.task_id, output,
      call: { id: `i${issue}`, name: "composio_run_action", arguments: { action: "GITHUB_UPDATE_ISSUE", arguments: { issue_number: issue } } },
    });
    update(1, "ERROR: GITHUB_UPDATE_ISSUE failed: 502");
    recordRunAction(h.connection.db, {
      orgId: h.orgId, runId: h.runId, taskId: task.task_id, output: "ERROR: reply lost",
      call: { id: "multi", name: "composio_run_action", arguments: { action: "GITHUB_UPDATE_ISSUE", arguments: { issue_number: 3, state: "closed" } } },
    });
    recordRunAction(h.connection.db, {
      orgId: h.orgId, runId: h.runId, taskId: task.task_id, output: "{\"successful\":true}",
      call: { id: "multi2", name: "composio_run_action", arguments: { action: "GITHUB_UPDATE_ISSUE", arguments: { state: "closed", issue_number: 3 } } },
    });
    update(2, "{\"successful\":true}");
    expect(unresolvedActionFailure(h.connection.db, h.runId)).toBe("The session ended with 1 failed action it did not redo: composio_run_action (ERROR: GITHUB_UPDATE_ISSUE failed: 502)");
    // A retry that confirms the lost reply, with the same input in another key order, redoes issue 1.
    recordRunAction(h.connection.db, {
      orgId: h.orgId, runId: h.runId, taskId: task.task_id, output: "{\"successful\":true}",
      call: { id: "retry", name: "composio_run_action", arguments: { arguments: { issue_number: 1 }, confirm_not_done: true, action: "GITHUB_UPDATE_ISSUE" } },
    });
    expect(unresolvedActionFailure(h.connection.db, h.runId)).toBeNull();
    h.connection.close();
  });
});
