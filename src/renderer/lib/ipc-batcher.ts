import type { DesktopEvent } from "@shared/types";

// --- Legacy simple batcher -- kept for backward compatibility ---

type BatchCallback = () => void;

export function createEventBatcher(callback: BatchCallback, windowMs = 50) {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function schedule() {
    if (timer !== null) return; // already scheduled -- coalesce
    timer = setTimeout(() => {
      timer = null;
      callback();
    }, windowMs);
  }

  function flush() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      callback();
    }
  }

  function dispose() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return { schedule, flush, dispose };
}

// --- Enhanced batcher for granular events ---

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
    default:
      return null;
  }
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
