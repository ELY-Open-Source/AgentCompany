import { useEffect, type MutableRefObject } from "react";
import type { DesktopEvent } from "@shared/types";
import { createDomainEventBatcher, type GranularEventEntry } from "../lib/ipc-batcher";
import { useAppStore } from "../state/store";

export function useDesktopEvents(
  refreshRef: MutableRefObject<() => Promise<void>>,
  logBufferRef: MutableRefObject<Record<string, string>>,
  incrementLogRevision: () => void,
) {
  useEffect(() => {
    void refreshRef.current();
    const store = useAppStore;

    async function handleGranularBatch(events: GranularEventEntry[]) {
      const companyId = store.getState().snapshot?.currentCompanyId ?? null;
      if (!companyId) {
        void refreshRef.current();
        return;
      }

      let needsFullRefresh = false;

      for (const entry of events) {
        // run-updated:completed touches too many entity types -- full refresh
        if (entry.type === "run-updated" && entry.action === "completed") {
          needsFullRefresh = true;
          break;
        }

        try {
          switch (entry.type) {
            case "task-updated": {
              if (entry.action === "deleted") {
                store.getState().removeTask(entry.entityId);
              } else {
                const result = await window.agentCompany.getTask({ companyId, id: entry.entityId });
                if (result.ok) {
                  store.getState().patchTask(result.data);
                } else {
                  store.getState().removeTask(entry.entityId);
                }
              }
              break;
            }
            case "run-updated": {
              if (entry.action === "deleted") {
                store.getState().removeRun(entry.entityId);
              } else {
                const result = await window.agentCompany.getRun({ companyId, id: entry.entityId });
                if (result.ok) {
                  store.getState().patchRun(result.data);
                } else {
                  store.getState().removeRun(entry.entityId);
                }
              }
              break;
            }
            case "approval-updated": {
              if (entry.action === "deleted") {
                store.getState().removeApproval(entry.entityId);
              } else {
                const result = await window.agentCompany.getApproval({ companyId, id: entry.entityId });
                if (result.ok) {
                  store.getState().patchApproval(result.data);
                } else {
                  store.getState().removeApproval(entry.entityId);
                }
              }
              break;
            }
            case "agent-updated": {
              const result = await window.agentCompany.getAgent({ companyId, id: entry.entityId });
              if (result.ok) {
                store.getState().patchAgent(result.data);
              } else {
                needsFullRefresh = true;
              }
              break;
            }
            case "budget-changed": {
              // Budget is a computed aggregate -- full refresh is needed
              needsFullRefresh = true;
              break;
            }
            default: {
              // Unknown granular event type -- fall back (per D-05 / PERF-03)
              needsFullRefresh = true;
              break;
            }
          }
        } catch {
          // IPC error during entity fetch -- fall back to full refresh (per pitfall 1)
          needsFullRefresh = true;
          break;
        }

        if (needsFullRefresh) break;
      }

      if (needsFullRefresh) {
        void refreshRef.current();
      } else {
        // Refresh sidebar badges after granular patches (per pitfall 3)
        void store.getState().refreshBadges();
      }
    }

    const batcher = createDomainEventBatcher(
      () => { void refreshRef.current(); },
      (events) => { void handleGranularBatch(events); },
      50,
    );

    const unsubscribe = window.agentCompany.subscribe((event: DesktopEvent) => {
      if (event.type === "run-log") {
        const MAX_LOG_BYTES_PER_RUN = 512_000;
        const MAX_TRACKED_RUNS = 50;
        const existing = logBufferRef.current[event.runId] ?? "";
        const updated = existing.length < MAX_LOG_BYTES_PER_RUN
          ? existing + event.chunk
          : existing.slice(-MAX_LOG_BYTES_PER_RUN / 2) + event.chunk;
        logBufferRef.current[event.runId] = updated;
        const runIds = Object.keys(logBufferRef.current);
        if (runIds.length > MAX_TRACKED_RUNS) {
          for (const oldId of runIds.slice(0, runIds.length - MAX_TRACKED_RUNS)) {
            delete logBufferRef.current[oldId];
          }
        }
        incrementLogRevision();
        return;
      }
      if (event.type === "shortcut") {
        if (event.action === "toggle-command-palette") store.getState().toggleCommandPalette();
        if (event.action === "toggle-console") store.getState().toggleConsole();
        if (event.action === "refresh") void refreshRef.current();
        return;
      }
      if (event.type === "notification-click") {
        store.getState().navigateTo(event.section, event.entityId);
        return;
      }
      // All data-mutating events go through the enhanced batcher
      batcher.push(event);
    });
    return () => {
      unsubscribe();
      batcher.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshRef and logBufferRef are stable refs; incrementLogRevision is a stable Zustand setter
  }, []);
}
