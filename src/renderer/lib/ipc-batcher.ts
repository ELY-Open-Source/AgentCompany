import type { DesktopEvent } from "@shared/types";

export interface GranularEventEntry {
  type: string;
  entityId: string;
  action: string;
}

const MAX_GRANULAR_EVENTS = 10;

export function entityKeyFromEvent(event: DesktopEvent): GranularEventEntry | null {
  switch (event.type) {
    case "task-updated":
      return { type: "task-updated", entityId: event.taskId, action: event.action };
    case "run-updated":
      return { type: "run-updated", entityId: event.runId, action: event.action };
    case "approval-updated":
      return { type: "approval-updated", entityId: event.approvalId, action: event.action };
    case "agent-updated":
      return { type: "agent-updated", entityId: event.agentId, action: event.action };
    case "budget-changed":
      return { type: "budget-changed", entityId: event.companyId, action: "changed" };
    // run-status is a run-level state change -- map onto run entity so
    // granular patchRun refetches the run record.
    case "run-status":
      return { type: "run-updated", entityId: event.runId, action: "status_changed" };
    // heartbeat-status mutates agent metadata (nextWakeAt / enabled) -- map
    // onto agent entity so granular patchAgent refetches.
    case "heartbeat-status":
      return { type: "agent-updated", entityId: event.agentId, action: "updated" };
    // agent-message posts a new comment under a task; patchTask refetch will
    // pick up the task's updated comment list.
    case "agent-message":
      return { type: "task-updated", entityId: event.taskId, action: "updated" };
    default:
      return null;
  }
}

// Events that do NOT affect ProfileSnapshot and therefore must not trigger
// a snapshot refresh -- they are handled exclusively by their own listeners.
const SNAPSHOT_IRRELEVANT_EVENT_TYPES = new Set<DesktopEvent["type"]>([
  "automation-fired",
  "recovery-needed",
]);

export function isSnapshotIrrelevantEvent(event: DesktopEvent): boolean {
  return SNAPSHOT_IRRELEVANT_EVENT_TYPES.has(event.type);
}

export function createDomainEventBatcher(
  onFullRefresh: () => void,
  onGranularBatch: (events: GranularEventEntry[]) => void,
  windowMs = 50,
  maxGranular = MAX_GRANULAR_EVENTS,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let hasDomainChanged = false;
  const pending = new Map<string, GranularEventEntry>();

  function push(event: DesktopEvent) {
    if (event.type === "domain-changed") {
      hasDomainChanged = true;
    } else {
      const entry = entityKeyFromEvent(event);
      if (entry) {
        const key = `${entry.type}:${entry.entityId}`;
        const existing = pending.get(key);
        // If any event in window has action "deleted", preserve that action
        if (existing && existing.action === "deleted" && entry.action !== "deleted") {
          // Keep the delete -- it takes priority
        } else {
          pending.set(key, entry);
        }
      } else {
        // Unknown event type -- treat as domain-changed for safety (per D-05)
        hasDomainChanged = true;
      }
    }
    if (timer === null) {
      timer = setTimeout(flushInternal, windowMs);
    }
  }

  function flushInternal() {
    timer = null;
    if (hasDomainChanged || pending.size > maxGranular) {
      onFullRefresh();
    } else if (pending.size > 0) {
      onGranularBatch([...pending.values()]);
    }
    hasDomainChanged = false;
    pending.clear();
  }

  function flush() {
    if (timer !== null) {
      clearTimeout(timer);
      flushInternal();
    }
  }

  function dispose() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    hasDomainChanged = false;
    pending.clear();
  }

  return { push, flush, dispose };
}
