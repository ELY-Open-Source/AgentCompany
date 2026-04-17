import { useEffect, useMemo, useState } from "react";
import type { AgentRecord, RunRecord, TaskRecord, WorkspaceRecord } from "@shared/types";
import { EmptyState } from "../ui";
import { useT } from "../../i18n";
import { RunQueue } from "./RunQueue";
import { RunDetail } from "./RunDetail";
import { useRunLogs } from "../../hooks/useRunLogs";

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
      const task = run.taskId ? taskMap.get(run.taskId) : undefined;
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

  const { logState, reload: reloadLogs, loadOlder: loadOlderLogs } = useRunLogs(selectedRun);

  useEffect(() => {
    if (selectedRunId && !runs.some((run) => run.id === selectedRunId)) {
      const fallbackRun = runs[0];
      if (fallbackRun) {
        onSelectRun(fallbackRun.id);
      }
    }
  }, [onSelectRun, runs, selectedRunId]);

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
          onReloadLog={reloadLogs}
          onLoadOlderLogs={() => void loadOlderLogs()}
          t={t}
        />
      ) : null}
    </div>
  );
}
