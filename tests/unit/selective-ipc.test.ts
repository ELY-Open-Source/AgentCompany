import { describe, it, expect, vi } from "vitest";
import type {
  DesktopEvent,
  TaskUpdatedEvent,
  RunUpdatedEvent,
  ApprovalUpdatedEvent,
  AgentUpdatedEvent,
  BudgetChangedEvent,
} from "@shared/types";
import type { GranularEventEntry } from "@renderer/lib/ipc-batcher";

describe("selective IPC event types", () => {
  it("TaskUpdatedEvent discriminated by type field", () => {
    const event: TaskUpdatedEvent = {
      type: "task-updated",
      taskId: "t-1",
      action: "created",
    };
    expect(event.type).toBe("task-updated");
    expect(event.taskId).toBe("t-1");
    expect(event.action).toBe("created");
  });

  it("RunUpdatedEvent discriminated by type field", () => {
    const event: RunUpdatedEvent = {
      type: "run-updated",
      runId: "r-1",
      action: "completed",
    };
    expect(event.type).toBe("run-updated");
    expect(event.runId).toBe("r-1");
    expect(event.action).toBe("completed");
  });

  it("ApprovalUpdatedEvent discriminated by type field", () => {
    const event: ApprovalUpdatedEvent = {
      type: "approval-updated",
      approvalId: "a-1",
      action: "decided",
    };
    expect(event.type).toBe("approval-updated");
    expect(event.approvalId).toBe("a-1");
    expect(event.action).toBe("decided");
  });

  it("AgentUpdatedEvent discriminated by type field", () => {
    const event: AgentUpdatedEvent = {
      type: "agent-updated",
      agentId: "ag-1",
      action: "updated",
    };
    expect(event.type).toBe("agent-updated");
    expect(event.agentId).toBe("ag-1");
    expect(event.action).toBe("updated");
  });

  it("BudgetChangedEvent discriminated by type field", () => {
    const event: BudgetChangedEvent = {
      type: "budget-changed",
      companyId: "c-1",
    };
    expect(event.type).toBe("budget-changed");
    expect(event.companyId).toBe("c-1");
  });

  it("all five new event types are assignable to DesktopEvent union", () => {
    const events: DesktopEvent[] = [
      { type: "task-updated", taskId: "t-1", action: "created" },
      { type: "run-updated", runId: "r-1", action: "status_changed" },
      { type: "approval-updated", approvalId: "a-1", action: "created" },
      { type: "agent-updated", agentId: "ag-1", action: "paused" },
      { type: "budget-changed", companyId: "c-1" },
    ];
    expect(events).toHaveLength(5);
  });

  it("DesktopEvent union has all 14 members (9 original + 5 new)", () => {
    // This is a compile-time check -- if any type is missing, TypeScript will error
    const exhaustiveCheck = (event: DesktopEvent): string => {
      switch (event.type) {
        case "run-log":
          return "run-log";
        case "domain-changed":
          return "domain-changed";
        case "shortcut":
          return "shortcut";
        case "run-status":
          return "run-status";
        case "heartbeat-status":
          return "heartbeat-status";
        case "agent-message":
          return "agent-message";
        case "automation-fired":
          return "automation-fired";
        case "new-message":
          return "new-message";
        case "notification-click":
          return "notification-click";
        case "task-updated":
          return "task-updated";
        case "run-updated":
          return "run-updated";
        case "approval-updated":
          return "approval-updated";
        case "agent-updated":
          return "agent-updated";
        case "budget-changed":
          return "budget-changed";
        case "thread-wait-state-updated":
          return "thread-wait-state-updated";
        case "recovery-needed":
          return "recovery-needed";
        default: {
          const _exhaustive: never = event;
          return _exhaustive;
        }
      }
    };
    // Dummy call to avoid unused-var warning
    expect(typeof exhaustiveCheck).toBe("function");
  });
});

// Extracted granular batch handler logic for testability
// Mirrors the handleGranularBatch function in App.tsx
async function handleGranularBatch(
  events: GranularEventEntry[],
  deps: {
    companyId: string | null;
    getTask: (input: { companyId: string; id: string }) => Promise<{ ok: boolean; data?: any }>;
    getRun: (input: { companyId: string; id: string }) => Promise<{ ok: boolean; data?: any }>;
    getApproval: (input: { companyId: string; id: string }) => Promise<{ ok: boolean; data?: any }>;
    getAgent: (input: { companyId: string; id: string }) => Promise<{ ok: boolean; data?: any }>;
    patchTask: (task: any) => void;
    removeTask: (id: string) => void;
    patchRun: (run: any) => void;
    removeRun: (id: string) => void;
    patchApproval: (approval: any) => void;
    removeApproval: (id: string) => void;
    patchAgent: (agent: any) => void;
    refreshBadges: () => Promise<void>;
    fullRefresh: () => void;
  },
) {
  if (!deps.companyId) {
    deps.fullRefresh();
    return;
  }

  let needsFullRefresh = false;

  for (const entry of events) {
    if (entry.type === "run-updated" && entry.action === "completed") {
      needsFullRefresh = true;
      break;
    }

    try {
      switch (entry.type) {
        case "task-updated": {
          if (entry.action === "deleted") {
            deps.removeTask(entry.entityId);
          } else {
            const result = await deps.getTask({ companyId: deps.companyId, id: entry.entityId });
            if (result.ok) {
              deps.patchTask(result.data);
            } else {
              deps.removeTask(entry.entityId);
            }
          }
          break;
        }
        case "run-updated": {
          if (entry.action === "deleted") {
            deps.removeRun(entry.entityId);
          } else {
            const result = await deps.getRun({ companyId: deps.companyId, id: entry.entityId });
            if (result.ok) {
              deps.patchRun(result.data);
            } else {
              deps.removeRun(entry.entityId);
            }
          }
          break;
        }
        case "approval-updated": {
          if (entry.action === "deleted") {
            deps.removeApproval(entry.entityId);
          } else {
            const result = await deps.getApproval({ companyId: deps.companyId, id: entry.entityId });
            if (result.ok) {
              deps.patchApproval(result.data);
            } else {
              deps.removeApproval(entry.entityId);
            }
          }
          break;
        }
        case "agent-updated": {
          const result = await deps.getAgent({ companyId: deps.companyId, id: entry.entityId });
          if (result.ok) {
            deps.patchAgent(result.data);
          } else {
            needsFullRefresh = true;
          }
          break;
        }
        case "budget-changed": {
          needsFullRefresh = true;
          break;
        }
        default: {
          needsFullRefresh = true;
          break;
        }
      }
    } catch {
      needsFullRefresh = true;
      break;
    }

    if (needsFullRefresh) break;
  }

  if (needsFullRefresh) {
    deps.fullRefresh();
  } else {
    void deps.refreshBadges();
  }
}

function createMockDeps() {
  return {
    companyId: "company-1" as string | null,
    getTask: vi.fn().mockResolvedValue({ ok: true, data: { id: "t-1", title: "Test task" } }),
    getRun: vi.fn().mockResolvedValue({ ok: true, data: { id: "r-1", status: "running" } }),
    getApproval: vi.fn().mockResolvedValue({ ok: true, data: { id: "a-1", state: "pending" } }),
    getAgent: vi.fn().mockResolvedValue({ ok: true, data: { id: "ag-1", name: "Agent" } }),
    patchTask: vi.fn(),
    removeTask: vi.fn(),
    patchRun: vi.fn(),
    removeRun: vi.fn(),
    patchApproval: vi.fn(),
    removeApproval: vi.fn(),
    patchAgent: vi.fn(),
    refreshBadges: vi.fn().mockResolvedValue(undefined),
    fullRefresh: vi.fn(),
  };
}

describe("handleGranularBatch", () => {
  it("task-updated event calls getTask and patchTask", async () => {
    const deps = createMockDeps();
    await handleGranularBatch(
      [{ type: "task-updated", entityId: "t-1", action: "updated" }],
      deps,
    );
    expect(deps.getTask).toHaveBeenCalledWith({ companyId: "company-1", id: "t-1" });
    expect(deps.patchTask).toHaveBeenCalledWith({ id: "t-1", title: "Test task" });
    expect(deps.fullRefresh).not.toHaveBeenCalled();
    expect(deps.refreshBadges).toHaveBeenCalled();
  });

  it("deleted task calls removeTask without fetching", async () => {
    const deps = createMockDeps();
    await handleGranularBatch(
      [{ type: "task-updated", entityId: "t-1", action: "deleted" }],
      deps,
    );
    expect(deps.removeTask).toHaveBeenCalledWith("t-1");
    expect(deps.getTask).not.toHaveBeenCalled();
    expect(deps.fullRefresh).not.toHaveBeenCalled();
  });

  it("run-updated:completed triggers full refresh", async () => {
    const deps = createMockDeps();
    await handleGranularBatch(
      [{ type: "run-updated", entityId: "r-1", action: "completed" }],
      deps,
    );
    expect(deps.fullRefresh).toHaveBeenCalled();
    expect(deps.getRun).not.toHaveBeenCalled();
    expect(deps.refreshBadges).not.toHaveBeenCalled();
  });

  it("failed getTask fetch falls back to removeTask", async () => {
    const deps = createMockDeps();
    deps.getTask.mockResolvedValue({ ok: false, error: { code: "NOT_FOUND", message: "nope" } });
    await handleGranularBatch(
      [{ type: "task-updated", entityId: "t-1", action: "updated" }],
      deps,
    );
    expect(deps.removeTask).toHaveBeenCalledWith("t-1");
    expect(deps.patchTask).not.toHaveBeenCalled();
  });

  it("calls refreshBadges after successful granular processing", async () => {
    const deps = createMockDeps();
    await handleGranularBatch(
      [{ type: "task-updated", entityId: "t-1", action: "created" }],
      deps,
    );
    expect(deps.refreshBadges).toHaveBeenCalled();
    expect(deps.fullRefresh).not.toHaveBeenCalled();
  });

  it("approval-updated event calls getApproval and patchApproval", async () => {
    const deps = createMockDeps();
    await handleGranularBatch(
      [{ type: "approval-updated", entityId: "a-1", action: "decided" }],
      deps,
    );
    expect(deps.getApproval).toHaveBeenCalledWith({ companyId: "company-1", id: "a-1" });
    expect(deps.patchApproval).toHaveBeenCalledWith({ id: "a-1", state: "pending" });
  });

  it("agent-updated event calls getAgent and patchAgent", async () => {
    const deps = createMockDeps();
    await handleGranularBatch(
      [{ type: "agent-updated", entityId: "ag-1", action: "paused" }],
      deps,
    );
    expect(deps.getAgent).toHaveBeenCalledWith({ companyId: "company-1", id: "ag-1" });
    expect(deps.patchAgent).toHaveBeenCalledWith({ id: "ag-1", name: "Agent" });
  });

  it("budget-changed triggers full refresh", async () => {
    const deps = createMockDeps();
    await handleGranularBatch(
      [{ type: "budget-changed", entityId: "c-1", action: "changed" }],
      deps,
    );
    expect(deps.fullRefresh).toHaveBeenCalled();
    expect(deps.refreshBadges).not.toHaveBeenCalled();
  });

  it("no companyId triggers full refresh", async () => {
    const deps = createMockDeps();
    deps.companyId = null;
    await handleGranularBatch(
      [{ type: "task-updated", entityId: "t-1", action: "updated" }],
      deps,
    );
    expect(deps.fullRefresh).toHaveBeenCalled();
    expect(deps.getTask).not.toHaveBeenCalled();
  });

  it("IPC error falls back to full refresh", async () => {
    const deps = createMockDeps();
    deps.getTask.mockRejectedValue(new Error("IPC failed"));
    await handleGranularBatch(
      [{ type: "task-updated", entityId: "t-1", action: "updated" }],
      deps,
    );
    expect(deps.fullRefresh).toHaveBeenCalled();
  });

  it("unknown event type triggers full refresh", async () => {
    const deps = createMockDeps();
    await handleGranularBatch(
      [{ type: "some-unknown-event", entityId: "x-1", action: "created" }],
      deps,
    );
    expect(deps.fullRefresh).toHaveBeenCalled();
  });

  it("run-updated:status_changed fetches and patches run", async () => {
    const deps = createMockDeps();
    await handleGranularBatch(
      [{ type: "run-updated", entityId: "r-1", action: "status_changed" }],
      deps,
    );
    expect(deps.getRun).toHaveBeenCalledWith({ companyId: "company-1", id: "r-1" });
    expect(deps.patchRun).toHaveBeenCalledWith({ id: "r-1", status: "running" });
    expect(deps.fullRefresh).not.toHaveBeenCalled();
  });
});
