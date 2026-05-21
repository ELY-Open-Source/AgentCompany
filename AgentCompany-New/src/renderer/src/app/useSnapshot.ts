import { useCallback, useEffect, useState } from "react";
import type { AppSnapshot } from "../../../shared/domain";
import type { DesktopResult } from "../../../shared/result";

export interface SnapshotActions {
  run<T extends AppSnapshot | null>(operation: () => Promise<DesktopResult<T>>): Promise<T | null>;
  reload(): Promise<void>;
}

export function useSnapshot(): {
  snapshot: AppSnapshot | null;
  error: string | null;
  actions: SnapshotActions;
} {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await window.agentCompany.loadSnapshot();
    if (result.ok) {
      setSnapshot(result.data);
      setError(null);
    } else {
      setError(result.error.message);
    }
  }, []);

  const run = useCallback(async <T extends AppSnapshot | null>(
    operation: () => Promise<DesktopResult<T>>,
  ): Promise<T | null> => {
    const result = await operation();
    if (result.ok) {
      if (result.data) setSnapshot(result.data as AppSnapshot);
      setError(null);
      return result.data;
    }
    setError(result.error.message);
    return null;
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
    return window.agentCompany.subscribe((event) => {
      if (event.type === "snapshot-changed") void load();
    });
  }, [load]);

  return { snapshot, error, actions: { run, reload: load } };
}
