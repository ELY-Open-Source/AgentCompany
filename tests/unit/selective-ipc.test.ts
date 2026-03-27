import { describe, it, expect } from "vitest";
import type {
  DesktopEvent,
  TaskUpdatedEvent,
  RunUpdatedEvent,
  ApprovalUpdatedEvent,
  AgentUpdatedEvent,
  BudgetChangedEvent,
} from "@shared/types";

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
