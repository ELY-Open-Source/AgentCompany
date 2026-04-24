import type { DesktopEvent } from "@shared/types";

export type SnapshotEntityEventType =
  | "task-updated"
  | "run-updated"
  | "approval-updated"
  | "agent-updated"
  | "budget-changed";

export interface SnapshotEntityEvent {
  type: SnapshotEntityEventType;
  entityId: string;
  action: string;
}

export type GranularEventEntry = SnapshotEntityEvent;

export type SnapshotEventDecision =
  | { kind: "entity"; entry: SnapshotEntityEvent }
  | { kind: "full-refresh" }
  | { kind: "ignore" };

export interface SnapshotEntityToken {
  snapshotEpoch: number;
  entityVersion: number;
}

export interface SnapshotRefreshToken {
  snapshotEpoch: number;
}

export interface SnapshotEventGuard {
  invalidateSnapshot: () => void;
  captureSnapshot: () => SnapshotRefreshToken;
  canApplySnapshot: (token: SnapshotRefreshToken) => boolean;
  invalidateEntity: (entry: SnapshotEntityEvent) => void;
  captureEntity: (entry: SnapshotEntityEvent) => SnapshotEntityToken;
  canApplyEntity: (entry: SnapshotEntityEvent, token: SnapshotEntityToken) => boolean;
}

export function classifySnapshotEvent(event: DesktopEvent): SnapshotEventDecision {
  switch (event.type) {
    case "task-updated":
      return { kind: "entity", entry: { type: "task-updated", entityId: event.taskId, action: event.action } };
    case "run-updated":
      return { kind: "entity", entry: { type: "run-updated", entityId: event.runId, action: event.action } };
    case "approval-updated":
      return {
        kind: "entity",
        entry: { type: "approval-updated", entityId: event.approvalId, action: event.action },
      };
    case "agent-updated":
      return { kind: "entity", entry: { type: "agent-updated", entityId: event.agentId, action: event.action } };
    case "budget-changed":
      return { kind: "entity", entry: { type: "budget-changed", entityId: event.companyId, action: "changed" } };
    case "run-status":
      return { kind: "entity", entry: { type: "run-updated", entityId: event.runId, action: "status_changed" } };
    case "heartbeat-status":
      return { kind: "entity", entry: { type: "agent-updated", entityId: event.agentId, action: "updated" } };
    case "agent-message":
      return { kind: "entity", entry: { type: "task-updated", entityId: event.taskId, action: "updated" } };
    case "automation-fired":
    case "recovery-needed":
    case "run-log":
    case "shortcut":
    case "notification-click":
      return { kind: "ignore" };
    case "domain-changed":
    case "new-message":
    case "thread-wait-state-updated":
    case "credentials-changed":
    case "agent-event":
    case "oauth:status":
    case "oauth:auth-url":
    case "oauth:progress":
    case "oauth:prompt-request":
    case "oauth:manual-code-request":
      return { kind: "full-refresh" };
    default:
      return { kind: "full-refresh" };
  }
}

export function createSnapshotEventGuard(): SnapshotEventGuard {
  let snapshotEpoch = 0;
  const entityVersions = new Map<string, number>();

  function entityKey(entry: SnapshotEntityEvent): string {
    return `${entry.type}:${entry.entityId}`;
  }

  function entityVersion(entry: SnapshotEntityEvent): number {
    return entityVersions.get(entityKey(entry)) ?? 0;
  }

  return {
    invalidateSnapshot() {
      snapshotEpoch += 1;
    },
    captureSnapshot() {
      return { snapshotEpoch };
    },
    canApplySnapshot(token) {
      return snapshotEpoch === token.snapshotEpoch;
    },
    invalidateEntity(entry) {
      const key = entityKey(entry);
      entityVersions.set(key, (entityVersions.get(key) ?? 0) + 1);
    },
    captureEntity(entry) {
      return {
        snapshotEpoch,
        entityVersion: entityVersion(entry),
      };
    },
    canApplyEntity(entry, token) {
      return snapshotEpoch === token.snapshotEpoch && entityVersion(entry) === token.entityVersion;
    },
  };
}
