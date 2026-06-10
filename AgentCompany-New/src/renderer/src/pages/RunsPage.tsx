import { useMemo, useState } from "react";
import { Avatar, Pill, Segmented } from "../shared/ui";
import type { AgentRecord, ProviderRecord, TaskRecord, TaskRunRecord } from "../../../shared/domain";
import type { PageProps } from "./types";
import { activeOrgId, formatRelative } from "./types";

type StatusFilter = "all" | "queued" | "running" | "completed" | "failed";
const FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "queued", label: "Queued" },
  { id: "running", label: "Running" },
  { id: "completed", label: "Done" },
  { id: "failed", label: "Failed" },
];

export function RunsPage({ snapshot }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const taskRuns = useMemo(() => snapshot.taskRuns.filter((r) => r.orgId === orgId), [snapshot.taskRuns, orgId]);
  const tasks = useMemo(() => snapshot.tasks.filter((t) => t.orgId === orgId), [snapshot.tasks, orgId]);
  const agents = useMemo(() => snapshot.agents.filter((a) => a.orgId === orgId), [snapshot.agents, orgId]);
  const providers = useMemo(() => snapshot.providers.filter((p) => p.orgId === orgId), [snapshot.providers, orgId]);
  const providerRequests = useMemo(() => snapshot.providerRequests.filter((r) => r.orgId === orgId), [snapshot.providerRequests, orgId]);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let list = filter === "all" ? taskRuns : taskRuns.filter((r) => r.state === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) => {
        const task = tasks.find((t) => t.id === r.taskId);
        const agent = agents.find((a) => a.id === r.agentId);
        return task?.title.toLowerCase().includes(q) || agent?.name.toLowerCase().includes(q) || r.id.includes(q);
      });
    }
    return list;
  }, [taskRuns, filter, search, tasks, agents]);

  const selected = selectedId ? taskRuns.find((r) => r.id === selectedId) ?? null : null;
  const queued = taskRuns.filter((r) => r.state === "queued").length;
  const running = taskRuns.filter((r) => r.state === "running").length;
  const failed = taskRuns.filter((r) => r.state === "failed").length;

  return (
    <div className="split-main">
      <aside className="secondary-pane" style={{ width: 340 }}>
        <div style={{ padding: "12px 12px 8px" }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Runs</div>
          <div className="row" style={{ gap: 6, marginBottom: 8, fontSize: 11, color: "var(--text-3)" }}>
            <span>{queued} queued</span><span>·</span><span>{running} running</span><span>·</span><span>{failed} failed</span>
          </div>
          <input
            className="input"
            placeholder="Search runs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          <Segmented value={filter} onChange={setFilter} options={FILTERS} />
        </div>
        <div className="pane-scroll">
          {filtered.map((run) => {
            const task = tasks.find((t) => t.id === run.taskId);
            const agent = agents.find((a) => a.id === run.agentId);
            const active = run.id === selectedId;
            return (
              <button
                key={run.id}
                type="button"
                className={`nav-row ${active ? "active" : ""}`}
                onClick={() => setSelectedId(run.id)}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 480, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {task?.title ?? run.taskId}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                    {agent?.name ?? "Agent"} · {run.trigger}
                  </div>
                </div>
                <Pill tone={runTone(run.state)}>{runLabel(run.state)}</Pill>
              </button>
            );
          })}
          {filtered.length === 0 && <div style={{ padding: 16, fontSize: 13, color: "var(--text-3)" }}>No runs</div>}
        </div>
      </aside>
      <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 24 }}>
        {selected ? (
          <RunDetail run={selected} tasks={tasks} agents={agents} providers={providers} providerRequests={providerRequests} />
        ) : (
          <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--text-3)", fontSize: 13 }}>
            Select a run
          </div>
        )}
      </div>
    </div>
  );
}

function RunDetail({ run, tasks, agents, providers, providerRequests }: {
  run: TaskRunRecord;
  tasks: TaskRecord[];
  agents: AgentRecord[];
  providers: ProviderRecord[];
  providerRequests: Array<{ id: string; orgId: string; providerId: string; model: string; state: string; responseText: string | null; inputCharCount: number; outputCharCount: number; createdAt: string }>;
}) {
  const task = tasks.find((t) => t.id === run.taskId);
  const agent = agents.find((a) => a.id === run.agentId);
  const provider = providers.find((p) => p.id === run.providerId);
  const request = run.providerRequestId ? providerRequests.find((r) => r.id === run.providerRequestId) : null;

  const started = run.startedAt ? new Date(run.startedAt) : null;
  const completed = run.completedAt ? new Date(run.completedAt) : null;
  const durationMs = started && completed ? completed.getTime() - started.getTime() : null;

  return (
    <div>
      <div className="row" style={{ gap: 10, marginBottom: 16 }}>
        {agent && <Avatar name={agent.name} size="sm" bot />}
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{task?.title ?? run.taskId}</div>
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>{run.id}</div>
        </div>
        <Pill tone={runTone(run.state)}>{runLabel(run.state)}</Pill>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "8px 14px", fontSize: 12.5, marginBottom: 20 }}>
        <MetaLabel>Agent</MetaLabel><div>{agent?.name ?? "—"} ({agent?.role ?? "—"})</div>
        <MetaLabel>Provider</MetaLabel><div>{provider?.label ?? "—"} · {provider?.model ?? "—"}</div>
        <MetaLabel>Trigger</MetaLabel><div>{run.trigger}</div>
        <MetaLabel>Created</MetaLabel><div>{formatRelative(run.createdAt)}</div>
        {run.startedAt && (<><MetaLabel>Started</MetaLabel><div>{formatRelative(run.startedAt)}</div></>)}
        {run.completedAt && (<><MetaLabel>Completed</MetaLabel><div>{formatRelative(run.completedAt)}</div></>)}
        {durationMs !== null && (<><MetaLabel>Duration</MetaLabel><div>{formatDuration(durationMs)}</div></>)}
        <MetaLabel>Context</MetaLabel><div className="mono" style={{ fontSize: 11 }}>{run.executionContextId}</div>
      </div>

      {run.state === "failed" && run.errorMessage && (
        <div className="card" style={{ padding: 14, marginBottom: 16, borderColor: "var(--red)" }}>
          <div className="section-label" style={{ color: "var(--red)", marginBottom: 6 }}>Error</div>
          <div style={{ fontSize: 12.5, color: "var(--text-1)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{run.errorMessage}</div>
        </div>
      )}

      {request && (
        <div className="card" style={{ padding: 14, marginBottom: 16 }}>
          <div className="section-label" style={{ marginBottom: 8 }}>Provider request</div>
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "6px 14px", fontSize: 12 }}>
            <MetaLabel>Request ID</MetaLabel><div className="mono" style={{ fontSize: 11 }}>{request.id}</div>
            <MetaLabel>Model</MetaLabel><div>{request.model}</div>
            <MetaLabel>State</MetaLabel><div>{request.state}</div>
            <MetaLabel>Input chars</MetaLabel><div className="num">{request.inputCharCount.toLocaleString()}</div>
            <MetaLabel>Output chars</MetaLabel><div className="num">{request.outputCharCount.toLocaleString()}</div>
          </div>
          {request.responseText && (
            <div style={{ marginTop: 12 }}>
              <div className="section-label" style={{ marginBottom: 6 }}>Response</div>
              <div style={{
                fontSize: 12,
                color: "var(--text-2)",
                whiteSpace: "pre-wrap",
                lineHeight: 1.5,
                maxHeight: 400,
                overflow: "auto",
                padding: 10,
                background: "var(--panel-3)",
                borderRadius: 8,
                fontFamily: "var(--font-mono)",
              }}>
                {request.responseText}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MetaLabel({ children }: { children: string }) {
  return <div style={{ color: "var(--text-3)" }}>{children}</div>;
}

function runTone(state: string): "red" | "amber" | "violet" | "green" | undefined {
  if (state === "failed") return "red";
  if (state === "running") return "violet";
  if (state === "queued") return "amber";
  if (state === "completed") return "green";
  return undefined;
}

function runLabel(state: string): string {
  if (state === "queued") return "Queued";
  if (state === "running") return "Running";
  if (state === "completed") return "Done";
  if (state === "failed") return "Failed";
  return state;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}
