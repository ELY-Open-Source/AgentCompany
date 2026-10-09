import { useEffect, useState } from "react";
import type { RunRequestRecord } from "../../../../shared/provider-runtime-domain";

export type LoadedRequests = { runId: string; requests: RunRequestRecord[] } | { runId: string; error: string };

/** Every model call of one run, read from the database (not the snapshot's window), refetched whenever `refreshKey` changes. */
export function useRunRequests(orgId: string, runId: string, refreshKey: unknown): LoadedRequests | null {
  // Fetched calls are kept with the run they belong to, so switching runs never shows another run's chain.
  const [loaded, setLoaded] = useState<LoadedRequests | null>(null);
  useEffect(() => {
    let cancelled = false;
    window.agentCompany.runRequests({ orgId, runId })
      .then((result) => {
        if (cancelled) return;
        setLoaded(result.ok ? { runId, requests: result.data } : { runId, error: result.error.message });
      })
      .catch((reason: unknown) => {
        if (!cancelled) setLoaded({ runId, error: reason instanceof Error ? reason.message : String(reason) });
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, runId, refreshKey]);
  return loaded && loaded.runId === runId ? loaded : null;
}
