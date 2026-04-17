import { useCallback, useEffect, useRef, useState } from "react";
import type { RunRecord } from "@shared/types";
import { LOG_CHUNK_BYTES, initialLogState, isActiveStatus } from "../components/runs/run-helpers";
import type { RunLogState } from "../components/runs/run-helpers";

const POLL_INTERVAL_MS = 2500;

export interface UseRunLogsResult {
  logState: RunLogState;
  reload: () => void;
  loadOlder: () => Promise<void>;
}

/**
 * Owns log loading, tailing, and older-chunk fetching for a single run.
 *
 * One effect handles both the initial tail fetch and periodic polling.
 * An AbortController scopes every in-flight request to the current run
 * selection so switching runs immediately discards stale responses, and
 * polling pauses when `document.hidden` to avoid wasting IPC calls.
 */
export function useRunLogs(selectedRun: RunRecord | null): UseRunLogsResult {
  const [logState, setLogState] = useState<RunLogState>(initialLogState);
  const [reloadKey, setReloadKey] = useState(0);
  const totalBytesRef = useRef(0);

  useEffect(() => {
    totalBytesRef.current = logState.totalBytes;
  }, [logState.totalBytes]);

  const reload = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!selectedRun) {
      setLogState(initialLogState);
      return;
    }

    const controller = new AbortController();
    let intervalId: number | null = null;

    async function fetchTail(initial: boolean) {
      if (!selectedRun) return;
      if (!initial && document.hidden) return;

      if (initial) {
        setLogState((current) => ({ ...current, loading: true, error: null }));
      }

      const metaResult = initial
        ? await window.agentCompany.getRunLogChunk({
            companyId: selectedRun.companyId,
            runId: selectedRun.id,
            offset: 0,
            limit: 1024,
          })
        : null;

      if (controller.signal.aborted) return;

      let totalBytes: number;
      if (initial) {
        if (!metaResult!.ok) {
          setLogState((current) => ({ ...current, loading: false, error: metaResult!.error.message }));
          return;
        }
        totalBytes = metaResult!.data.totalBytes;
      } else {
        totalBytes = totalBytesRef.current;
      }

      const startOffset = Math.max(0, totalBytes - LOG_CHUNK_BYTES);
      const tailResult =
        initial && startOffset === 0 && totalBytes <= LOG_CHUNK_BYTES
          ? metaResult!
          : await window.agentCompany.getRunLogChunk({
              companyId: selectedRun.companyId,
              runId: selectedRun.id,
              offset: startOffset,
              limit: LOG_CHUNK_BYTES,
            });

      if (controller.signal.aborted) return;
      if (!tailResult.ok) {
        if (initial) {
          setLogState((current) => ({ ...current, loading: false, error: tailResult.error.message }));
        }
        return;
      }

      setLogState({ ...tailResult.data, loading: false, error: null });
    }

    void fetchTail(true);

    if (isActiveStatus(selectedRun.status)) {
      intervalId = window.setInterval(() => {
        void fetchTail(false);
      }, POLL_INTERVAL_MS);
    }

    return () => {
      controller.abort();
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, [selectedRun, reloadKey]);

  const loadOlder = useCallback(async () => {
    if (!selectedRun || logState.offset <= 0) return;

    const nextOffset = Math.max(0, logState.offset - LOG_CHUNK_BYTES);
    setLogState((current) => ({ ...current, loading: true, error: null }));

    const result = await window.agentCompany.getRunLogChunk({
      companyId: selectedRun.companyId,
      runId: selectedRun.id,
      offset: nextOffset,
      limit: logState.offset - nextOffset,
    });

    if (!result.ok) {
      setLogState((current) => ({ ...current, loading: false, error: result.error.message }));
      return;
    }

    setLogState((current) => ({
      ...result.data,
      content: `${result.data.content}${current.content}`,
      nextOffset: current.nextOffset,
      eof: current.eof,
      loading: false,
      error: null,
    }));
  }, [selectedRun, logState.offset]);

  return { logState, reload, loadOlder };
}
