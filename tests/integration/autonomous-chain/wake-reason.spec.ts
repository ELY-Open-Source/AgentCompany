/**
 * Step 8: Wake reason injection into task prompt.
 * Physically extracted from autonomous-chain.spec.ts without behavior changes.
 */

import { describe, expect, it } from "vitest";
import { buildTaskPrompt } from "../../../src/main/prompt-builder/index";
import { installSharedSetup } from "./shared-setup";

const shared = installSharedSetup();
const { createAgent, buildCtx } = shared;

describe("Step 8: Wake reason injection", () => {
  it("includes wake reason section for non-timer triggers", () => {
    const agentId = createAgent({ name: "CTO", role: "CTO" });
    const ceoId = createAgent({ name: "CEO", role: "CEO" });
    const ceo = shared.db.getAgent(ceoId);

    const ctx = buildCtx({
      agentId,
      chainOfCommand: [ceo],
      wakeReason: "subtask_completed",
    });

    const prompt = buildTaskPrompt(ctx);
    expect(prompt).toContain("Wake Reason");
    expect(prompt).toContain("subtask you delegated has been completed");
  });

  it("includes wake reason for timer triggers", () => {
    const agentId = createAgent({ name: "Agent" });

    const ctx = buildCtx({
      agentId,
      wakeReason: "timer",
    });

    const prompt = buildTaskPrompt(ctx);
    expect(prompt).toContain("Wake Reason");
    expect(prompt).toContain("Regular heartbeat check-in");
  });

  it("includes wake reason for manual triggers", () => {
    const agentId = createAgent({ name: "Agent" });

    const ctx = buildCtx({
      agentId,
      wakeReason: "manual",
    });

    const prompt = buildTaskPrompt(ctx);
    expect(prompt).toContain("Wake Reason");
    expect(prompt).toContain("manually triggered by the human operator");
  });

  it("includes correct message for each wake reason", () => {
    const agentId = createAgent({ name: "Agent" });

    const reasons: Record<string, string> = {
      assignment: "You have been assigned a new task",
      goal_activated: "goal you own has been activated",
      approval_resolved: "approval you requested has been decided",
      subtask_completed: "subtask you delegated has been completed",
      comment: "new comment has been posted",
      report_blocked: "reports is blocked",
      report_failed: "reports has failed",
    };

    for (const [reason, expectedText] of Object.entries(reasons)) {
      const ctx = buildCtx({
        agentId,
        wakeReason: reason,
      });
      const prompt = buildTaskPrompt(ctx);
      expect(prompt).toContain("Wake Reason");
      expect(prompt).toContain(expectedText);
    }
  });

  it("handles unknown wake reason gracefully", () => {
    const agentId = createAgent({ name: "Agent" });

    const ctx = buildCtx({
      agentId,
      wakeReason: "custom_trigger_xyz",
    });

    const prompt = buildTaskPrompt(ctx);
    expect(prompt).toContain("Wake Reason");
    expect(prompt).toContain("Trigger: custom_trigger_xyz");
  });

  it("includes wake reason before task description", () => {
    const agentId = createAgent({ name: "Agent" });
    const taskId = shared.db.saveTask({
      companyId: shared.companyId,
      title: "Do the thing",
      description: "Test task",
      assigneeAgentId: agentId,
      workspaceId: shared.workspaceId,
      priority: "medium",
      status: "todo",
    });
    const task = shared.db.getTask(taskId);

    const ctx = buildCtx({
      agentId,
      task,
      wakeReason: "assignment",
    });

    const prompt = buildTaskPrompt(ctx);
    const wakeIndex = prompt.indexOf("Wake Reason");
    const taskIndex = prompt.indexOf("Your immediate task");
    expect(wakeIndex).toBeGreaterThan(-1);
    expect(taskIndex).toBeGreaterThan(-1);
    expect(wakeIndex).toBeLessThan(taskIndex);
  });
});
