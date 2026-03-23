import { useEffect, useMemo, useState } from "react";
import type { AgentRecord, RunRecord, TaskRecord, WorkspaceRecord } from "@shared/types";
import { EmptyState } from "../ui";
import { useT } from "../../i18n";
import { LOG_CHUNK_BYTES, initialLogState, isActiveStatus } from "./run-helpers";
import type { RunLogState } from "./run-helpers";
import { RunQueue } from "./RunQueue";
import { RunDetail } from "./RunDetail";

interface RunCenterProps {
  runs: RunRecord[];
  tasks: TaskRecord[];
  agents: AgentRecord[];
  workspaces: WorkspaceRecord[];
  selectedRunId: string | null;
  onSelectRun: (runId: string) => void;
  onCancelRun: (runId: string) => Promise<void> | void;
  onOpenLogPath: (path: string) => Promise<void> | void;
  onOpenConsole: (runId: string) => void;
}

export function RunCenter({
  runs,
  tasks,
  agents,
  workspaces,
  selectedRunId,
  onSelectRun,
  onCancelRun,
  onOpenLogPath,
  onOpenConsole,
}: RunCenterProps) {
  const t = useT();
  const [statusFilter, setStatusFilter] = useState<"all" | RunRecord["status"]>("all");
  const [search, setSearch] = useState("");
  const [logState, setLogState] = useState<RunLogState>(initialLogState);
  const [logReloadKey, setLogReloadKey] = useState(0);

  const agentMap = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const taskMap = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const workspaceMap = useMemo(() => new Map(workspaces.map((workspace) => [workspace.id, workspace])), [workspaces]);

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null,
    [runs, selectedRunId],
  );

  const filteredRuns = useMemo(() => {
    const query = search.trim().toLowerCase();
    return runs.filter((run) => {
      if (statusFilter !== "all" && run.status !== statusFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      const task = taskMap.get(run.taskId);
      const agent = agentMap.get(run.agentId);
      const workspace = run.workspaceId ? workspaceMap.get(run.workspaceId) : null;
      return [
        task?.title ?? "",
        agent?.name ?? "",
        workspace?.name ?? "",
        run.summary ?? "",
        run.errorMessage ?? "",
        run.connectorId,
        run.id,
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [agentMap, runs, search, statusFilter, taskMap, workspaceMap]);

  useEffect(() => {
    if (selectedRunId && !runs.some((run) => run.id === selectedRunId)) {
      const fallbackRun = runs[0];
      if (fallbackRun) {
        onSelectRun(fallbackRun.id);
      }
    }
  }, [onSelectRun, runs, selectedRunId]);

  useEffect(() => {
    let cancelled = false;

    async function loadInitialChunk() {
      if (!selectedRun) {
        setLogState(initialLogState);
        return;
      }

      setLogState((current) => ({ ...current, loading: true, error: null }));

      const metaResult = await window.agentCompany.getRunLogChunk({
        companyId: selectedRun.companyId,
        runId: selectedRun.id,
        offset: 0,
        limit: 1024,
      });

      if (!metaResult.ok) {
        if (!cancelled) {
          setLogState((current) => ({
            ...current,
            loading: false,
            error: metaResult.error.message,
          }));
        }
        return;
      }

      const totalBytes = metaResult.data.totalBytes;
      const startOffset = Math.max(0, totalBytes - LOG_CHUNK_BYTES);
      const chunkResult =
        startOffset === 0 && totalBytes <= LOG_CHUNK_BYTES
          ? metaResult
          : await window.agentCompany.getRunLogChunk({
              companyId: selectedRun.companyId,
              runId: selectedRun.id,
              offset: startOffset,
              limit: LOG_CHUNK_BYTES,
            });

      if (!chunkResult.ok) {
        if (!cancelled) {
          setLogState((current) => ({
            ...current,
            loading: false,
            error: chunkResult.error.message,
          }));
        }
        return;
      }

      if (!cancelled) {
        setLogState({
          ...chunkResult.data,
          loading: false,
          error: null,
        });
      }
    }

    void loadInitialChunk();

    return () => {
      cancelled = true;
    };
  }, [logReloadKey, selectedRun]);

  useEffect(() => {
    if (!selectedRun || !isActiveStatus(selectedRun.status)) return;
    let cancelled = false;
    const intervalId = window.setInterval(async () => {
      const latest = await window.agentCompany.getRunLogChunk({
        companyId: selectedRun.companyId,
        runId: selectedRun.id,
        offset: Math.max(0, logState.totalBytes - LOG_CHUNK_BYTES),
        limit: LOG_CHUNK_BYTES,
      });

      if (!latest.ok || cancelled) {
        return;
      }

      setLogState({
        ...latest.data,
        loading: false,
        error: null,
      });
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [logState.totalBytes, selectedRun]);

  async function loadOlderLogs() {
    if (!selectedRun || logState.offset <= 0) {
      return;
    }

    const nextOffset = Math.max(0, logState.offset - LOG_CHUNK_BYTES);
    setLogState((current) => ({ ...current, loading: true, error: null }));

    const result = await window.agentCompany.getRunLogChunk({
      companyId: selectedRun.companyId,
      runId: selectedRun.id,
      offset: nextOffset,
      limit: logState.offset - nextOffset,
    });

    if (!result.ok) {
      setLogState((current) => ({
        ...current,
        loading: false,
        error: result.error.message,
      }));
      return;
    }

    setLogState({
      ...result.data,
      content: `${result.data.content}${logState.content}`,
      nextOffset: logState.nextOffset,
      eof: logState.eof,
      loading: false,
      error: null,
    });
  }

  if (runs.length === 0) {
    return (
      <EmptyState
        title={t("runs.noRunsYet")}
        detail={t("runs.noRunsDetail")}
      />
    );
  }

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <RunQueue
        filteredRuns={filteredRuns}
        selectedRun={selectedRun}
        taskMap={taskMap}
        agentMap={agentMap}
        workspaceMap={workspaceMap}
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        search={search}
        setSearch={setSearch}
        onSelectRun={onSelectRun}
        t={t}
      />

      {selectedRun ? (
        <RunDetail
          selectedRun={selectedRun}
          taskMap={taskMap}
          agentMap={agentMap}
          workspaceMap={workspaceMap}
          logState={logState}
          onOpenConsole={onOpenConsole}
          onCancelRun={onCancelRun}
          onOpenLogPath={onOpenLogPath}
          onReloadLog={() => setLogReloadKey((current) => current + 1)}
          onLoadOlderLogs={() => void loadOlderLogs()}
          t={t}
        />
      ) : null}
    </div>
  );
}
