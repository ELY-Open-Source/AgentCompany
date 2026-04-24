import { describe, it, expect } from "vitest";
import type {
  DesktopEvent,
  TaskUpdatedEvent,
  RunUpdatedEvent,
  ApprovalUpdatedEvent,
  AgentUpdatedEvent,
  BudgetChangedEvent,
} from "@shared/types";
import {
  classifySnapshotEvent,
} from "@renderer/lib/snapshot-events";

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

  it("all five entity event types are assignable to DesktopEvent union", () => {
    const events: DesktopEvent[] = [
      { type: "task-updated", taskId: "t-1", action: "created" },
      { type: "run-updated", runId: "r-1", action: "status_changed" },
      { type: "approval-updated", approvalId: "a-1", action: "created" },
      { type: "agent-updated", agentId: "ag-1", action: "paused" },
      { type: "budget-changed", companyId: "c-1" },
    ];
    expect(events).toHaveLength(5);
  });

  it("DesktopEvent union has all members used by snapshot classification", () => {
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
        case "oauth:status":
          return "oauth:status";
        case "oauth:auth-url":
          return "oauth:auth-url";
        case "oauth:progress":
          return "oauth:progress";
        case "oauth:prompt-request":
          return "oauth:prompt-request";
        case "oauth:manual-code-request":
          return "oauth:manual-code-request";
        case "credentials-changed":
          return "credentials-changed";
        case "agent-event":
          return "agent-event";
        default: {
          const _exhaustive: never = event;
          return _exhaustive;
        }
      }
    };
    expect(typeof exhaustiveCheck).toBe("function");
  });
});

describe("classifySnapshotEvent", () => {
  it("maps direct entity events to one immediate entity decision", () => {
    expect(classifySnapshotEvent({ type: "task-updated", taskId: "t-1", action: "updated" })).toEqual({
      kind: "entity",
      entry: { type: "task-updated", entityId: "t-1", action: "updated" },
    });
    expect(classifySnapshotEvent({ type: "run-updated", runId: "r-1", action: "status_changed" })).toEqual({
      kind: "entity",
      entry: { type: "run-updated", entityId: "r-1", action: "status_changed" },
    });
    expect(classifySnapshotEvent({ type: "approval-updated", approvalId: "a-1", action: "decided" })).toEqual({
      kind: "entity",
      entry: { type: "approval-updated", entityId: "a-1", action: "decided" },
    });
    expect(classifySnapshotEvent({ type: "agent-updated", agentId: "ag-1", action: "paused" })).toEqual({
      kind: "entity",
      entry: { type: "agent-updated", entityId: "ag-1", action: "paused" },
    });
    expect(classifySnapshotEvent({ type: "budget-changed", companyId: "company-1" })).toEqual({
      kind: "entity",
      entry: { type: "budget-changed", entityId: "company-1", action: "changed" },
    });
  });

  it("maps legacy progress events to their owning entities", () => {
    expect(classifySnapshotEvent({ type: "run-status", runId: "r-1", status: "running", message: "Running" })).toEqual({
      kind: "entity",
      entry: { type: "run-updated", entityId: "r-1", action: "status_changed" },
    });
    expect(classifySnapshotEvent({ type: "heartbeat-status", agentId: "ag-1", enabled: true, nextWakeAt: null })).toEqual({
      kind: "entity",
      entry: { type: "agent-updated", entityId: "ag-1", action: "updated" },
    });
    expect(classifySnapshotEvent({ type: "agent-message", taskId: "t-1", comment: {} } as DesktopEvent)).toEqual({
      kind: "entity",
      entry: { type: "task-updated", entityId: "t-1", action: "updated" },
    });
  });

  it("routes domain-wide events to full refresh", () => {
    const events: DesktopEvent[] = [
      { type: "domain-changed" },
      { type: "new-message" } as DesktopEvent,
      { type: "thread-wait-state-updated", threadId: "th-1", companyId: "c-1", waitStateId: "w-1", action: "created" },
      { type: "credentials-changed", connectorId: "claude-pro" },
      { type: "agent-event", runId: "r-1", agentId: "ag-1", companyId: "c-1", taskId: "t-1", emittedAt: "2026-01-01", event: { type: "x" } },
      { type: "oauth:status", connectorId: "claude-pro", status: "active" },
      { type: "oauth:auth-url", connectorId: "claude-pro", url: "https://example.com" },
      { type: "oauth:progress", connectorId: "claude-pro", message: "Working" },
      { type: "oauth:prompt-request", connectorId: "claude-pro", requestId: "req-1", message: "Code" },
      { type: "oauth:manual-code-request", connectorId: "claude-pro", requestId: "req-1" },
    ];

    for (const event of events) {
      expect(classifySnapshotEvent(event)).toEqual({ kind: "full-refresh" });
    }
  });

  it("ignores events with independent listeners", () => {
    const events: DesktopEvent[] = [
      { type: "automation-fired", ruleId: "rule-1", ruleName: "Rule", trigger: "schedule", action: "run_task" },
      { type: "recovery-needed", interruptedRuns: [] },
      { type: "run-log", runId: "r-1", stream: "stdout", chunk: "chunk" },
      { type: "shortcut", action: "refresh" },
      { type: "notification-click", section: "tasks", entityId: "t-1" },
    ];

    for (const event of events) {
      expect(classifySnapshotEvent(event)).toEqual({ kind: "ignore" });
    }
  });

  it("routes unknown runtime event shapes to full refresh", () => {
    expect(classifySnapshotEvent({ type: "future-event" } as unknown as DesktopEvent)).toEqual({
      kind: "full-refresh",
    });
  });
});
