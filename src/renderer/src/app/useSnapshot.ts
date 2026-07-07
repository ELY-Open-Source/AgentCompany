import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppSnapshot } from "../../../shared/domain";
import type { DesktopResult } from "../../../shared/result";

export interface SnapshotActions {
  run<T extends AppSnapshot | null>(operation: () => Promise<DesktopResult<T>>): Promise<T | null>;
  reload(): Promise<void>;
}

export function useSnapshot(): {
  snapshot: AppSnapshot | null;
  actions: SnapshotActions;
} {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);

  const load = useCallback(async () => {
    const result = await window.agentCompany.loadSnapshot();
    if (!result.ok) throw new Error(result.error.message);
    setSnapshot(result.data);
  }, []);

  const run = useCallback(async <T extends AppSnapshot | null>(
    operation: () => Promise<DesktopResult<T>>,
  ): Promise<T | null> => {
    const result = await operation();
    if (!result.ok) throw new Error(result.error.message);
    if (result.data) setSnapshot(result.data as AppSnapshot);
    return result.data;
  }, []);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastLoadAt = 0;
    // Change events arrive in bursts while agents run; reload at most every
    // 800ms with a trailing load so the UI converges without render storms.
    const scheduleReload = () => {
      if (disposed || timer) return;
      const wait = Math.max(0, 800 - (Date.now() - lastLoadAt));
      timer = setTimeout(() => {
        timer = null;
        lastLoadAt = Date.now();
        void load();
      }, wait);
    };
    void Promise.resolve().then(() => {
      lastLoadAt = Date.now();
      return load();
    });
    const unsubscribe = window.agentCompany.subscribe((event) => {
      if (event.type === "snapshot-changed") scheduleReload();
    });
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [load]);

  const actions = useMemo<SnapshotActions>(() => ({ run, reload: load }), [run, load]);
  return { snapshot, actions };
}
