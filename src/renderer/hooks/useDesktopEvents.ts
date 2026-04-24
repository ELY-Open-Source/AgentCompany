import { useEffect, type MutableRefObject } from "react";
import type { DesktopEvent } from "@shared/types";
import {
  classifySnapshotEvent,
  createSnapshotEventGuard,
  type GranularEventEntry,
} from "../lib/snapshot-events";
import { useAppStore } from "../state/store";

export function useDesktopEvents(
  refreshRef: MutableRefObject<(shouldApply?: () => boolean) => Promise<void>>,
  logBufferRef: MutableRefObject<Record<string, string>>,
  incrementLogRevision: () => void,
) {
  useEffect(() => {
    const store = useAppStore;
    const eventGuard = createSnapshotEventGuard();

    function requestFullRefresh() {
      eventGuard.invalidateSnapshot();
      const token = eventGuard.captureSnapshot();
      void refreshRef.current(() => eventGuard.canApplySnapshot(token));
    }

    requestFullRefresh();

    async function handleSnapshotEntityEvent(entry: GranularEventEntry) {
      const companyId = store.getState().snapshot?.currentCompanyId ?? null;
      if (!companyId) {
        requestFullRefresh();
        return;
      }

      let needsFullRefresh = false;
      eventGuard.invalidateSnapshot();
      eventGuard.invalidateEntity(entry);
      const token = eventGuard.captureEntity(entry);

      if (entry.type === "run-updated" && entry.action === "completed") {
        needsFullRefresh = true;
      } else {
        try {
          switch (entry.type) {
            case "task-updated": {
              if (entry.action === "deleted") {
                store.getState().removeTask(entry.entityId);
              } else {
                const result = await window.agentCompany.getTask({ companyId, id: entry.entityId });
                if (!eventGuard.canApplyEntity(entry, token)) return;
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
                if (!eventGuard.canApplyEntity(entry, token)) return;
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
                if (!eventGuard.canApplyEntity(entry, token)) return;
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
              if (!eventGuard.canApplyEntity(entry, token)) return;
              if (result.ok) {
                store.getState().patchAgent(result.data);
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
        }
      }

      if (needsFullRefresh) {
        requestFullRefresh();
      }
    }

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
        if (event.action === "refresh") requestFullRefresh();
        return;
      }
      if (event.type === "notification-click") {
        store.getState().navigateTo(event.section, event.entityId);
        return;
      }

      const decision = classifySnapshotEvent(event);
      if (decision.kind === "ignore") {
        return;
      }
      if (decision.kind === "full-refresh") {
        requestFullRefresh();
        return;
      }

      void handleSnapshotEntityEvent(decision.entry);
    });
    return () => {
      unsubscribe();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshRef and logBufferRef are stable refs; incrementLogRevision is a stable Zustand setter
  }, []);
}
