import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowClockwise,
  FolderOpen,
  Lightning,
  ListChecks,
  PlayCircle,
  WarningCircle,
} from "@phosphor-icons/react";
import type { AgentRecord, RunRecord, TaskRecord, WorkspaceRecord } from "@shared/types";
import { formatMoney, formatTime, timeAgo } from "../lib/formatters";
import { ActionButton, EmptyState, Input, ListFrame, ListRow, Panel, Select, StatusPill } from "./ui";

const LOG_CHUNK_BYTES = 65_536;

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

interface RunLogState {
  content: string;
  offset: number;
  nextOffset: number;
  totalBytes: number;
  eof: boolean;
  loading: boolean;
  error: string | null;
}

const initialLogState: RunLogState = {
  content: "",
  offset: 0,
  nextOffset: 0,
  totalBytes: 0,
  eof: true,
  loading: false,
  error: null,
};

function isActiveStatus(status: RunRecord["status"]) {
  return status === "queued" || status === "running";
}

function isAttentionStatus(status: RunRecord["status"]) {
  return status === "failed" || status === "timed_out" || status === "interrupted";
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

  const groupedCounts = useMemo(() => {
    let active = 0;
    let attention = 0;
    let completed = 0;

    for (const run of runs) {
      if (isActiveStatus(run.status)) {
        active += 1;
      } else if (isAttentionStatus(run.status)) {
        attention += 1;
      } else {
        completed += 1;
      }
    }

    return { active, attention, completed };
  }, [runs]);

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
    if (!selectedRun || !isActiveStatus(selectedRun.status)) {
      return;
    }

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
        title="No runs yet"
        detail="Start a task run from the task queue or onboarding handoff. This surface becomes the operator console for queue state, failures, and live log tails."
      />
    );
  }

  return (
    <div className="space-y-10">
      <div className="grid gap-3 md:grid-cols-3">
        <RunSummaryCard
          label="Active"
          value={groupedCounts.active}
          detail="Queued or running right now"
          icon={PlayCircle}
        />
        <RunSummaryCard
          label="Needs attention"
          value={groupedCounts.attention}
          detail="Failed, timed out, or interrupted"
          icon={WarningCircle}
          tone="danger"
        />
        <RunSummaryCard
          label="Completed"
          value={groupedCounts.completed}
          detail="Finished without current intervention"
          icon={ListChecks}
        />
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel
            title="Run queue"
            action={(
              <Select
                compact
                value={statusFilter}
                onChange={(value) => setStatusFilter(value as "all" | RunRecord["status"])}
                options={[
                  { value: "all", label: "All" },
                  { value: "queued", label: "Queued" },
                  { value: "running", label: "Running" },
                  { value: "succeeded", label: "Succeeded" },
                  { value: "failed", label: "Failed" },
                  { value: "timed_out", label: "Timed out" },
                  { value: "cancelled", label: "Cancelled" },
                  { value: "interrupted", label: "Interrupted" },
                ]}
              />
            )}
          >
            <div className="mb-4">
              <Input
                ariaLabel="Search runs"
                value={search}
                onChange={setSearch}
                placeholder="Search by task, agent, connector, workspace, or error"
              />
            </div>
            <ListFrame>
              {filteredRuns.map((run) => {
                const task = taskMap.get(run.taskId);
                const agent = agentMap.get(run.agentId);
                const workspace = run.workspaceId ? workspaceMap.get(run.workspaceId) : null;
                const title = task?.title ?? (run.summary || `Run ${run.id.slice(0, 8)}`);
                const supportingText = run.errorMessage || run.summary || "No summary yet";
                return (
                  <ListRow
                    key={run.id}
                    onClick={() => onSelectRun(run.id)}
                    className={selectedRun?.id === run.id ? "bg-[color:var(--accent-soft)]" : "hover:bg-[color:var(--panel-soft)]"}
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-semibold text-[color:var(--text)]">{title}</div>
                          <div className="mt-0.5 truncate text-[11px] text-[color:var(--muted)]">
                            {agent?.name ?? "Unknown agent"} via {run.connectorId} {workspace ? `· ${workspace.name}` : ""}
                          </div>
                        </div>
                        <StatusPill status={run.status} />
                      </div>
                      <div className="flex items-center justify-between gap-3 text-[11px] text-[color:var(--muted)]">
                        <span className="truncate">{supportingText}</span>
                        <span className="shrink-0">{timeAgo(run.updatedAt)}</span>
                      </div>
                    </div>
                  </ListRow>
                );
              })}
            </ListFrame>
            {filteredRuns.length === 0 ? (
              <EmptyState
                title="No runs match this filter"
                detail="Widen the status filter or clear the search query to inspect the full run history."
              />
            ) : null}
          </Panel>
        </div>

        <div className="space-y-6">
          {selectedRun ? (
            <>
              <Panel
                title="Run detail"
                action={(
                  <div className="flex items-center gap-2">
                    <ActionButton
                      label="Open console"
                      icon={Lightning}
                      onClick={() => onOpenConsole(selectedRun.id)}
                    />
                    {isActiveStatus(selectedRun.status) ? (
                      <ActionButton
                        label="Cancel run"
                        tone="danger"
                        icon={WarningCircle}
                        onClick={() => void onCancelRun(selectedRun.id)}
                      />
                    ) : null}
                  </div>
                )}
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <RunMeta label="Status" value={<StatusPill status={selectedRun.status} />} />
                  <RunMeta label="Connector" value={selectedRun.connectorId} />
                  <RunMeta label="Task" value={taskMap.get(selectedRun.taskId)?.title ?? selectedRun.taskId} />
                  <RunMeta label="Agent" value={agentMap.get(selectedRun.agentId)?.name ?? selectedRun.agentId} />
                  <RunMeta label="Workspace" value={selectedRun.workspaceId ? (workspaceMap.get(selectedRun.workspaceId)?.name ?? selectedRun.workspaceId) : "No exclusive workspace lock"} />
                  <RunMeta label="Model" value={selectedRun.model ?? "Connector default"} />
                  <RunMeta label="Started" value={formatTime(selectedRun.startedAt)} />
                  <RunMeta label="Finished" value={formatTime(selectedRun.finishedAt)} />
                  <RunMeta label="Cost" value={formatMoney(selectedRun.costUsd)} />
                  <RunMeta label="Log bytes" value={logState.totalBytes.toLocaleString()} />
                </div>
                {selectedRun.errorMessage ? (
                  <div className="mt-5 rounded-[10px] border border-[color:var(--danger)] bg-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-[color:var(--danger)]">
                    {selectedRun.errorMessage}
                  </div>
                ) : null}
                {selectedRun.logPath ? (
                  <div className="mt-5">
                    <ActionButton
                      label="Open log file"
                      icon={FolderOpen}
                      onClick={() => void onOpenLogPath(selectedRun.logPath!)}
                    />
                  </div>
                ) : null}
              </Panel>

              <Panel
                title="Log tail"
                eyebrow="Incremental reader"
                action={(
                  <div className="flex items-center gap-2">
                    <ActionButton
                      label="Reload tail"
                      icon={ArrowClockwise}
                      onClick={() => setLogReloadKey((current) => current + 1)}
                    />
                    {logState.offset > 0 ? (
                      <ActionButton
                        label="Load older"
                        icon={ListChecks}
                        onClick={() => void loadOlderLogs()}
                        disabled={logState.loading}
                      />
                    ) : null}
                  </div>
                )}
              >
                {logState.error ? (
                  <div className="rounded-[10px] border border-[color:var(--danger)] bg-[color:var(--danger-soft)] px-4 py-3 text-[13px] text-[color:var(--danger)]">
                    {logState.error}
                  </div>
                ) : null}
                <div className="mb-3 flex items-center justify-between text-[11px] text-[color:var(--muted)]">
                  <span>
                    Showing bytes {logState.offset.toLocaleString()} to {logState.nextOffset.toLocaleString()} of {logState.totalBytes.toLocaleString()}
                  </span>
                  <span>{logState.loading ? "Refreshing…" : logState.eof ? "At latest tail" : "Tail window loaded"}</span>
                </div>
                <div className="max-h-[420px] overflow-auto rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3">
                  <pre className="mono whitespace-pre-wrap text-[12px] leading-relaxed text-[color:var(--muted-strong)]">
                    {logState.content || "No log output captured yet."}
                  </pre>
                </div>
              </Panel>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RunSummaryCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number;
  detail: string;
  icon: React.ElementType;
  tone?: "default" | "danger";
}) {
  return (
    <div className="rounded-[12px] border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)]">{label}</div>
          <div className={`mt-1 text-[28px] font-semibold tracking-[-0.03em] ${tone === "danger" ? "text-[color:var(--danger)]" : "text-[color:var(--text)]"}`}>
            {value}
          </div>
          <div className="mt-1 text-[12px] text-[color:var(--muted)]">{detail}</div>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-[10px] ${tone === "danger" ? "bg-[color:var(--danger-soft)] text-[color:var(--danger)]" : "bg-[color:var(--panel-soft)] text-[color:var(--muted-strong)]"}`}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

function RunMeta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-3.5 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{label}</div>
      <div className="mt-1 text-[13px] text-[color:var(--text)]">{value}</div>
    </div>
  );
}
