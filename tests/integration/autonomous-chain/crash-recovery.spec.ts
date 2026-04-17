/**
 * Step 7: Worker crash recovery (database layer).
 * Physically extracted from autonomous-chain.spec.ts without behavior changes.
 */

import { describe, expect, it } from "vitest";
import { AppDatabase } from "../../../src/main/database";
import { installSharedSetup } from "./shared-setup";

const shared = installSharedSetup();
const { createAgent } = shared;

describe("Step 7: Worker crash recovery (database layer)", () => {
  it("interruptStaleRuns clears running and queued runs on init", async () => {
    const agentId = createAgent({ name: "Agent" });
    const taskId = shared.db.saveTask({
      companyId: shared.companyId,
      title: "In-progress task",
      description: "Running when crash happened",
      assigneeAgentId: agentId,
      workspaceId: shared.workspaceId,
      priority: "medium",
      status: "in_progress",
    });

    const run = shared.db.createRun({
      companyId: shared.companyId,
      taskId,
      agentId,
      workspaceId: shared.workspaceId,
      connectorId: "openai-codex",
    });

    shared.db.markRunStatus(run.id, "running", "Started");

    // Verify it's running
    let snapshot = shared.db.listSnapshot();
    expect(snapshot.runs.find((r) => r.id === run.id)?.status).toBe("running");

    // Simulate app restart — close and re-init
    shared.db.close();

    const profileDir = shared.tempDirs[shared.tempDirs.length - 1]!;
    shared.db = new AppDatabase(profileDir);
    shared.db.init(); // This calls interruptStaleRuns()

    snapshot = shared.db.listSnapshot();
    const recoveredRun = snapshot.runs.find((r) => r.id === run.id);
    expect(recoveredRun?.status).toBe("interrupted");
  });

  it("finishRun can mark interrupted runs from crash recovery", () => {
    const agentId = createAgent({ name: "Agent" });
    const taskId = shared.db.saveTask({
      companyId: shared.companyId,
      title: "Crash recovery task",
      description: "Test",
      assigneeAgentId: agentId,
      workspaceId: shared.workspaceId,
      priority: "medium",
      status: "in_progress",
    });

    const run = shared.db.createRun({
      companyId: shared.companyId,
      taskId,
      agentId,
      workspaceId: shared.workspaceId,
      connectorId: "openai-codex",
    });

    shared.db.markRunStatus(run.id, "running", "Started");

    // Simulate crash recovery - mark as interrupted
    shared.db.finishRun({
      runId: run.id,
      status: "interrupted",
      summary: "Worker process crashed.",
      errorMessage: "Worker process exited unexpectedly.",
      exitCode: 1,
      signal: null,
      model: null,
      sessionDisplayId: null,
      costUsd: null,
      unattributedCost: true,
    });

    const snapshot = shared.db.listSnapshot();
    const recovered = snapshot.runs.find((r) => r.id === run.id);
    expect(recovered?.status).toBe("interrupted");
    expect(recovered?.errorMessage).toBe("Worker process exited unexpectedly.");
  });
});
