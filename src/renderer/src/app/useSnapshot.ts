import { supersedes } from "./snapshot-order";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppSnapshot } from "../../../shared/domain";
import type { DesktopResult } from "../../../shared/result";

export interface SnapshotActions {
  run<T extends AppSnapshot | null>(operation: () => Promise<DesktopResult<T>>): Promise<T | null>;
  reload(): Promise<void>;
}

/** The latest failed load since the last success, and how many loads in a row have failed. */
export interface SyncFailure {
  message: string;
  attempts: number;
}

export function useSnapshot(): {
  snapshot: AppSnapshot | null;
  syncFailure: SyncFailure | null;
  /** When the data on screen was last read in full (ISO), so stale data can say how old it is. */
  syncedAt: string | null;
  actions: SnapshotActions;
} {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [syncFailure, setSyncFailure] = useState<SyncFailure | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  // The newest data version on screen; a change event at or below it needs no reload.
  const shownVersion = useRef(-1);

  const load = useCallback(async () => {
    try {
      const result = await window.agentCompany.loadSnapshot();
      if (!result.ok) throw new Error(result.error.message);
      setSyncFailure(null);
      if (!supersedes(shownVersion.current, result.data.dataVersion)) return;
      shownVersion.current = result.data.dataVersion;
      setSnapshot(result.data);
      setSyncedAt(new Date().toISOString());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSyncFailure((current) => ({ message, attempts: (current?.attempts ?? 0) + 1 }));
      throw error;
    }
  }, []);

  const run = useCallback(async <T extends AppSnapshot | null>(
    operation: () => Promise<DesktopResult<T>>,
  ): Promise<T | null> => {
    const result = await operation();
    if (!result.ok) throw new Error(result.error.message);
    if (result.data && supersedes(shownVersion.current, (result.data as AppSnapshot).dataVersion)) {
      shownVersion.current = (result.data as AppSnapshot).dataVersion;
      setSnapshot(result.data as AppSnapshot);
      setSyncFailure(null);
      setSyncedAt(new Date().toISOString());
    }
    return result.data;
  }, []);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let lastLoadAt = 0;
    // A failed load must not strand the app on a blank shell: log it loudly
    // and retry until the main process answers (IPC hiccups are transient).
    const guardedLoad = () => {
      load().catch((error) => {
        console.error(`[snapshot] load failed, retrying: ${error instanceof Error ? error.message : String(error)}`);
        if (disposed || retryTimer) return;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          guardedLoad();
        }, 1_500);
      });
    };
    // Change events arrive in bursts while agents run; reload at most every
    // 800ms with a trailing load so the UI converges without render storms.
    const scheduleReload = () => {
      if (disposed || timer) return;
      const wait = Math.max(0, 800 - (Date.now() - lastLoadAt));
      timer = setTimeout(() => {
        timer = null;
        lastLoadAt = Date.now();
        guardedLoad();
      }, wait);
    };
    void Promise.resolve().then(() => {
      lastLoadAt = Date.now();
      guardedLoad();
    });
    const unsubscribe = window.agentCompany.subscribe((event) => {
      if (event.type === "snapshot-changed" && event.version > shownVersion.current) scheduleReload();
    });
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
      unsubscribe();
    };
  }, [load]);

  const actions = useMemo<SnapshotActions>(() => ({ run, reload: load }), [run, load]);
  return { snapshot, syncFailure, syncedAt, actions };
}
