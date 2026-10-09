import { isIdOrNull, oneOf, usePersistentState } from "../shared/view-state";
import { requestStateLabel, runTriggerLabel } from "../i18n/labels";
import { RunRequestList } from "./runs/RunRequestList";
import { useRunRequests } from "./runs/use-run-requests";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, Button, Pill, Segmented } from "../shared/ui";
import type { AgentRecord, ProviderRecord, RunCursor, TaskRecord, TaskRunRecord } from "../../../shared/domain";
import type { PageProps } from "./types";
import { activeOrgId, formatRelative } from "./types";
import { t } from "../i18n/i18n";

const STATUS_FILTERS = ["all", "queued", "running", "completed", "failed"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: "all", label: t("All") },
  { id: "queued", label: t("Queued") },
  { id: "running", label: t("Running") },
  { id: "completed", label: t("Done") },
  { id: "failed", label: t("Failed") },
];

export function RunsPage({ snapshot, actions, navigate, focus }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const recentRuns = useMemo(() => snapshot.taskRuns.filter((r) => r.orgId === orgId), [snapshot.taskRuns, orgId]);
  // Older runs page in from the database; their range, from a pinned position, refreshes with each reload.
  const [pinned, setPinned] = useState<RunCursor | null>(null);
  const [olderRuns, setOlderRuns] = useState<TaskRunRecord[]>([]);
  const [olderDone, setOlderDone] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const anchorId = recentRuns.length > 0 ? recentRuns[0].id : null;
  useEffect(() => {
    if (!pinned) return;
    let cancelled = false;
    window.agentCompany.runHistory({ orgId, beforeRunId: anchorId, from: pinned }).then((result) => {
      if (cancelled) return;
      if (!result.ok) throw new Error(result.error.message);
      setOlderRuns(result.data.runs);
      setOlderDone(!result.data.hasMore);
      setHistoryError(null);
    }).catch((error: unknown) => {
      if (!cancelled) setHistoryError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
    };
  }, [orgId, anchorId, pinned, recentRuns]);
  const taskRuns = useMemo(() => [...olderRuns, ...recentRuns], [olderRuns, recentRuns]);
  const oldestShownId = taskRuns.length > 0 ? taskRuns[0].id : null;
  const loadOlder = useCallback(() => {
    window.agentCompany.runHistory({ orgId, beforeRunId: oldestShownId, limit: 100 }).then((result) => {
      if (!result.ok) throw new Error(result.error.message);
      setHistoryError(null);
      // With nothing older, the oldest shown run's position is pinned so later reloads keep the range.
      const position = result.data.oldest ?? result.data.boundary;
      if (position) setPinned(position);
      setOlderDone(!result.data.hasMore);
    }).catch((error: unknown) => setHistoryError(error instanceof Error ? error.message : String(error)));
  }, [orgId, oldestShownId]);
  // While the snapshot holds none of this company's runs and nothing is pinned, each reload asks the database for the newest page.
  useEffect(() => {
    if (recentRuns.length === 0 && pinned === null) loadOlder();
  }, [recentRuns, pinned, loadOlder]);
  const tasks = useMemo(() => snapshot.tasks.filter((t) => t.orgId === orgId), [snapshot.tasks, orgId]);
  const agents = useMemo(() => snapshot.agents.filter((a) => a.orgId === orgId), [snapshot.agents, orgId]);
  const providers = useMemo(() => snapshot.providers.filter((p) => p.orgId === orgId), [snapshot.providers, orgId]);
  // A linked run is never hidden by a filter left from before.
  const [filter, setFilter] = usePersistentState<StatusFilter>(`${orgId}:runs.filter`, "all", oneOf(STATUS_FILTERS), focus?.kind === "run" ? "all" : undefined);
  const [selectedId, setSelectedId] = usePersistentState<string | null>(`${orgId}:runs.selected`, null, isIdOrNull, focus?.kind === "run" ? focus.id : undefined);
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
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{t("Runs")}</div>
          <div className="row" style={{ gap: 8, marginBottom: 8, fontSize: 12, color: "var(--text-3)" }}>
            <span>{t("{n} queued", { n: queued })}</span><span>·</span><span>{t("{n} running", { n: running })}</span><span>·</span><span>{t("{n} failed", { n: failed })}</span>
          </div>
          <input
            className="input"
            aria-label={t("Search runs")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          <Segmented value={filter} onChange={setFilter} options={FILTERS} />
        </div>
        <div className="pane-scroll">
          {/* Newest first, so "show older runs" continues below. */}
          {[...filtered].reverse().map((run) => {
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
                  <div style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {task?.title ?? run.taskId}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {agent?.name ?? t("Agent")} · {runTriggerLabel(run.trigger)}
                  </div>
                </div>
                <Pill tone={runTone(run.state)}>{runLabel(run.state)}</Pill>
              </button>
            );
          })}
          {filtered.length === 0 && <div style={{ padding: 16, fontSize: 14, color: "var(--text-3)" }}>{t("No runs")}</div>}
          {historyError && <div className="form-error" role="alert" style={{ padding: "0 16px" }}>{historyError}</div>}
          <div style={{ padding: 12, display: "flex", justifyContent: "center" }}>
            {olderDone
              ? <span style={{ fontSize: 12, color: "var(--text-3)" }}>{t("These are all the runs.")}</span>
              : <Button size="small" onClick={loadOlder}>{t("Show older runs")}</Button>}
          </div>
        </div>
      </aside>
      <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 24 }}>
        {selected ? (
          <RunDetail key={selected.id} run={selected} tasks={tasks} agents={agents} providers={providers} actions={actions} onOpenTask={(taskId) => navigate("work", { kind: "task", id: taskId })} />
        ) : (
          <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--text-3)", fontSize: 14 }}>
            {t("Select a run")}
          </div>
        )}
      </div>
    </div>
  );
}

function RunDetail({ run, tasks, agents, providers, actions, onOpenTask }: {
  actions: PageProps["actions"];
  onOpenTask: (taskId: string) => void;
  run: TaskRunRecord;
  tasks: TaskRecord[];
  agents: AgentRecord[];
  providers: ProviderRecord[];
}) {
  const task = tasks.find((t) => t.id === run.taskId);
  const agent = agents.find((a) => a.id === run.agentId);
  const provider = providers.find((p) => p.id === run.providerId);
  // The run's calls come from the database, so an old run still shows its output; refetched with each snapshot reload.
  const loadedRequests = useRunRequests(run.orgId, run.id, run);
  const request = loadedRequests && "requests" in loadedRequests && run.providerRequestId
    ? loadedRequests.requests.find((item) => item.id === run.providerRequestId) ?? null
    : null;

  const started = run.startedAt ? new Date(run.startedAt) : null;
  const completed = run.completedAt ? new Date(run.completedAt) : null;
  const durationMs = started && completed ? completed.getTime() - started.getTime() : null;
  // Stop a running session, cancel one not yet started, or start a new session that picks up from the journal.
  const [controlError, setControlError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const control = (operation: () => Promise<unknown>) => {
    setControlError(null);
    setBusy(true);
    operation()
      .catch((error: unknown) => setControlError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false));
  };
  const stop = () => control(() => actions.run(() => window.agentCompany.stopRun({ runId: run.id })));
  const cancel = () => control(() => actions.run(() => window.agentCompany.cancelQueuedRun({ orgId: run.orgId, runId: run.id })));
  const again = () => control(() => actions.run(() => window.agentCompany.runTask({ orgId: run.orgId, taskId: run.taskId })));

  return (
    <div>
      <div className="row" style={{ gap: 10, marginBottom: 16 }}>
        {agent && <Avatar name={agent.name} size="sm" bot />}
        <div>
          <button type="button" className="link-button" style={{ fontSize: 16, fontWeight: 600 }} aria-label={t("Open task {title}", { title: task?.title ?? run.taskId })} onClick={() => onOpenTask(run.taskId)}>
            {task?.title ?? run.taskId}
          </button>
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>{run.id}</div>
        </div>
        <Pill tone={runTone(run.state)}>{runLabel(run.state)}</Pill>
        {run.state === "running" && <Button size="small" onClick={stop} disabled={busy}>{t("Stop")}</Button>}
        {run.state === "queued" && <Button size="small" onClick={cancel} disabled={busy}>{t("Cancel run")}</Button>}
        {run.state === "failed" && <Button size="small" onClick={again} disabled={busy}>{busy ? t("Running…") : t("Retry")}</Button>}
        {(run.state === "stopped" || run.state === "superseded") && <Button size="small" onClick={again} disabled={busy}>{busy ? t("Running…") : t("Resume")}</Button>}
      </div>
      {run.state === "queued" && <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 8 }}>{t("A cancelled session can start again on the next heartbeat; block the task to keep it stopped.")}</div>}
      {(run.state === "failed" || run.state === "stopped" || run.state === "superseded") && (
        <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 8 }}>{t("A new session on the task picks up from what earlier sessions did and where they stopped.")}</div>
      )}
      {controlError && <div className="form-error" role="alert">{controlError}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "8px 16px", fontSize: 14, marginBottom: 20 }}>
        <MetaLabel>{t("Agent")}</MetaLabel><div>{agent?.name ?? "—"} ({agent?.role ?? "—"})</div>
        <MetaLabel>{t("Provider")}</MetaLabel><div>{provider?.label ?? "—"}</div>
        <MetaLabel>{t("Model")}</MetaLabel><div>{run.runModel ?? t("Chosen when the session starts")}</div>
        <MetaLabel>{t("Trigger")}</MetaLabel><div>{runTriggerLabel(run.trigger)}</div>
        <MetaLabel>{t("Created")}</MetaLabel><div>{formatRelative(run.createdAt)}</div>
        {run.startedAt && (<><MetaLabel>{t("Started")}</MetaLabel><div>{formatRelative(run.startedAt)}</div></>)}
        {run.completedAt && (<><MetaLabel>{t("Completed")}</MetaLabel><div>{formatRelative(run.completedAt)}</div></>)}
        {durationMs !== null && (<><MetaLabel>{t("Duration")}</MetaLabel><div>{formatDuration(durationMs)}</div></>)}
        <MetaLabel>{t("Context")}</MetaLabel><div className="mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}>{run.executionContextId}</div>
      </div>

      <RunRequestList loaded={loadedRequests} />

      {run.state === "superseded" && run.errorMessage && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div className="section-label" style={{ marginBottom: 8 }}>{t("Why it did not run")}</div>
          <div style={{ fontSize: 14, color: "var(--text-1)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{run.errorMessage}</div>
        </div>
      )}
      {run.state === "failed" && run.errorMessage && (
        <div className="card" style={{ padding: 16, marginBottom: 16, borderColor: "var(--red)" }}>
          <div className="section-label" style={{ color: "var(--red)", marginBottom: 8 }}>{t("Error")}</div>
          <div style={{ fontSize: 14, color: "var(--text-1)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{run.errorMessage}</div>
        </div>
      )}

      {run.capabilityWarnings && (
        <div className="card" style={{ padding: 16, marginBottom: 16, borderColor: "var(--amber)" }}>
          <div className="section-label" style={{ color: "var(--amber)", marginBottom: 8 }}>{t("Missing this run")}</div>
          <div style={{ fontSize: 14, color: "var(--text-1)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{run.capabilityWarnings}</div>
        </div>
      )}

      {request && (
        <div className="card" style={{ padding: 16, marginBottom: 16 }}>
          <div className="section-label" style={{ marginBottom: 8 }}>{t("Provider request")}</div>
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "8px 16px", fontSize: 14 }}>
            <MetaLabel>{t("Request ID")}</MetaLabel><div className="mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}>{request.id}</div>
            <MetaLabel>{t("Model")}</MetaLabel><div>{request.model}</div>
            <MetaLabel>{t("State")}</MetaLabel><div>{requestStateLabel(request.state)}</div>
            <MetaLabel>{t("Input chars")}</MetaLabel><div className="num">{request.inputCharCount.toLocaleString()}</div>
            <MetaLabel>{t("Output chars")}</MetaLabel><div className="num">{request.outputCharCount.toLocaleString()}</div>
            <MetaLabel>{t("Tokens")}</MetaLabel><div className="num">{request.inputTokens === null ? t("not reported") : t("{input} in · {output} out", { input: request.inputTokens.toLocaleString(), output: (request.outputTokens ?? 0).toLocaleString() })}</div>
            <MetaLabel>{t("Cost")}</MetaLabel><div className="num">{request.costCents === null ? t("unpriced") : `$${(request.costCents / 100).toFixed(4)}`}</div>
          </div>
          {request.responseText && (
            <div style={{ marginTop: 12 }}>
              <div className="section-label" style={{ marginBottom: 6 }}>{t("Response")}</div>
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
  if (state === "queued") return t("Queued");
  if (state === "running") return t("Running");
  if (state === "completed") return t("Done");
  if (state === "failed") return t("Failed");
  if (state === "superseded") return t("Superseded");
  if (state === "stopped") return t("Stopped");
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
