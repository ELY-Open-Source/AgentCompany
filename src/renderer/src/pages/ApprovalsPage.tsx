import { oneOf, usePersistentState } from "../shared/view-state";
import { approvalKindLabel } from "../i18n/labels";
import { decideEach, type BatchResult } from "./approvals/decide-each";
import { DECIDED_PAGE, decidedWindow } from "./approvals/decided-window";
import { ApprovalDetailDialog, ApprovalRecordDialog } from "./approvals/ApprovalDialogs";
import { RISK_TONES } from "./approvals/risk-tones";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, Button, Icon, Pill } from "../shared/ui";
import { TopbarActions } from "../shared/TopbarActions";
import type {
  AgentRecord,
  ApprovalRecord,
  EmployeeRecord,
  RiskLevel,
} from "../../../shared/domain";
import type { ApprovalDrift } from "../../../shared/approval-pin";
import { APPROVAL_STATE, RISK_LEVEL } from "../../../shared/domain";
import type { PageProps } from "./types";
import { activeOrgId, formatRelative, requireActiveEmployee } from "./types";
import { t } from "../i18n/i18n";

type RiskFilter = "all" | RiskLevel;

/** Ids per drift check; the IPC contract allows up to 1000. */
const DRIFT_BATCH = 500;

const RISK_FILTERS: ReadonlyArray<{ id: RiskFilter; label: string }> = [
  { id: "all", label: t("All risk") },
  { id: RISK_LEVEL.HIGH, label: t("High") },
  { id: RISK_LEVEL.MEDIUM, label: t("Medium") },
  { id: RISK_LEVEL.LOW, label: t("Low") },
];

export function ApprovalsPage({ snapshot, actions, navigate, focus }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const employee = requireActiveEmployee(snapshot);
  const focusedApproval = focus?.kind === "approval" ? focus.id : null;
  // A linked request is never hidden by a filter left from before.
  const [filter, setFilter] = usePersistentState<RiskFilter>(`${orgId}:approvals.filter`, "all", oneOf(["all", "low", "medium", "high"] as const), focusedApproval ? "all" : undefined);
  const [editingId, setEditingId] = useState<string | null>(
    focusedApproval && snapshot.approvals.some((item) => item.id === focusedApproval && item.state === "pending") ? focusedApproval : null,
  );
  const openTask = (taskId: string) => navigate("work", { kind: "task", id: taskId });

  const approvals = useMemo(() => snapshot.approvals.filter((item) => item.orgId === orgId), [snapshot.approvals, orgId]);
  const employees = snapshot.employees.filter((item) => item.orgId === orgId);
  const agents = snapshot.agents.filter((item) => item.orgId === orgId);

  const pending = approvals.filter((approval) => approval.state === APPROVAL_STATE.PENDING);
  const decided = approvals.filter((approval) => approval.state !== APPROVAL_STATE.PENDING);
  const [decidedLimit, setDecidedLimit] = useState(DECIDED_PAGE);
  const shownDecided = decidedWindow(decided, focusedApproval, decidedLimit);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewing = viewingId ? decided.find((approval) => approval.id === viewingId) ?? null : null;
  // Drift is checked for exactly the decided requests on screen, and again when a record opens, since files change outside the app.
  const checkedIds = [...shownDecided.map((approval) => approval.id), ...(viewing && !shownDecided.includes(viewing) ? [viewing.id] : [])].join(",");
  useEffect(() => {
    let cancelled = false;
    const approvalIds = checkedIds ? checkedIds.split(",") : [];
    // The check takes at most DRIFT_BATCH ids per call, so a long history is checked in batches.
    const batches = Array.from({ length: Math.ceil(approvalIds.length / DRIFT_BATCH) }, (_, index) => approvalIds.slice(index * DRIFT_BATCH, (index + 1) * DRIFT_BATCH));
    void Promise.all(batches.map((batch) => window.agentCompany.approvalDrifts({ orgId, approvalIds: batch }))).then((results) => {
      if (cancelled) return;
      const failed = results.find((result) => !result.ok);
      if (failed && !failed.ok) {
        setDriftError(failed.error.message);
        return;
      }
      setDrifts(Object.assign({}, ...results.map((result) => (result.ok ? result.data : {}))));
      setDriftError(null);
    });
    return () => {
      cancelled = true;
    };
  }, [orgId, approvals, checkedIds, viewingId]);
  const filteredPending = filter === "all" ? pending : pending.filter((approval) => approval.risk === filter);
  const weeklyDecided = decided.filter((approval) => withinDays(approval.decidedAt, 7));
  const approved7d = weeklyDecided.filter((approval) => approval.state === APPROVAL_STATE.APPROVED).length;
  const declined7d = weeklyDecided.filter((approval) => approval.state === APPROVAL_STATE.DECLINED).length;
  const medianTime = computeMedianMinutes(weeklyDecided);

  const editing = editingId ? approvals.find((approval) => approval.id === editingId) ?? null : null;

  // Drift is read from disk in the main process, again whenever the approvals change.
  const [drifts, setDrifts] = useState<Record<string, ApprovalDrift>>({});
  const [driftError, setDriftError] = useState<string | null>(null);

  const decide = async (approval: ApprovalRecord, state: "approved" | "declined", notes?: string) => {
    await actions.run(() => window.agentCompany.decideApproval({
      orgId,
      approvalId: approval.id,
      state,
      decidedByEmployeeId: employee.id,
      notes,
    }));
  };
  // A row decision shows its own refusal; the request stays listed until it is decided.
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [busyRows, setBusyRows] = useState<Set<string>>(new Set());
  const decideRow = (approval: ApprovalRecord, state: "approved" | "declined") => {
    setBusyRows((current) => new Set(current).add(approval.id));
    setRowErrors(({ [approval.id]: _old, ...rest }) => rest);
    decide(approval, state)
      .catch((error: unknown) => setRowErrors((current) => ({ ...current, [approval.id]: error instanceof Error ? error.message : String(error) })))
      .finally(() => setBusyRows((current) => {
        const next = new Set(current);
        next.delete(approval.id);
        return next;
      }));
  };

  const [batch, setBatch] = useState<{ total: number; done: number; result: BatchResult | null } | null>(null);
  const approveAllLowRisk = () => {
    const lows = filteredPending.filter((approval) => approval.risk === RISK_LEVEL.LOW);
    if (lows.length === 0) return;
    setBatch({ total: lows.length, done: 0, result: null });
    void decideEach(lows, (approval) => decide(approval, "approved"), (done) => setBatch((current) => current && { ...current, done }))
      .then((result) => setBatch({ total: lows.length, done: lows.length, result }));
  };
  const batchRunning = batch !== null && batch.result === null;

  return (
    <div className="page">
      <TopbarActions>
        <RiskMenu filter={filter} onChange={setFilter} />
        <Button tone="primary" onClick={approveAllLowRisk} disabled={batchRunning}>
          {batchRunning ? t("Approving {done} of {total}…", { done: batch.done, total: batch.total }) : t("Approve all low risk")}
        </Button>
      </TopbarActions>
      <h1 className="page-h1">{t("Approvals")}</h1>
      <p className="page-sub">
        {t("{pending} pending · {approved} approved this week", { pending: pending.length, approved: approved7d })}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
        <StatTile label={t("Pending")} value={String(pending.length)} tone="amber" />
        <StatTile label={t("Median time")} value={formatMinutes(medianTime)} />
        <StatTile label={t("Approved (7d)")} value={String(approved7d)} />
        <StatTile label={t("Declined (7d)")} value={String(declined7d)} />
      </div>

      {batch?.result && <BatchSummary total={batch.total} result={batch.result} onDismiss={() => setBatch(null)} />}
      {filteredPending.length > 0 && <div className="section-label" style={{ marginBottom: 10 }}>{t("Pending")}</div>}
      {filteredPending.map((approval) => (
        <ApprovalRow
          key={approval.id}
          approval={approval}
          requester={resolveRequester(approval, employees, agents)}
          isBot={approval.requestedByType === "agent"}
          busy={busyRows.has(approval.id) || batchRunning}
          error={rowErrors[approval.id] ?? null}
          onApprove={() => decideRow(approval, "approved")}
          onDecline={() => decideRow(approval, "declined")}
          onReview={() => setEditingId(approval.id)}
        />
      ))}

      {decided.length > 0 && (
        <>
          <div className="section-label" style={{ margin: "32px 0 10px" }}>{t("Recently decided")}</div>
          {driftError && <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 8 }}>{t("Could not check approved content: {message}", { message: driftError })}</div>}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {shownDecided.map((approval, index) => (
              <DecidedRow
                key={approval.id}
                approval={approval}
                drift={drifts[approval.id] ?? null}
                requester={resolveRequester(approval, employees, agents)}
                decider={resolveDecider(approval, employees)}
                last={index === shownDecided.length - 1}
                focused={approval.id === focusedApproval}
                onOpenTask={openTask}
                onView={() => setViewingId(approval.id)}
              />
            ))}
          </div>
          {decided.length > decidedLimit && (
            <div className="row" style={{ justifyContent: "center", marginTop: 12, gap: 10 }}>
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>{t("Showing {shown} of {total}", { shown: Math.min(decidedLimit, decided.length), total: decided.length })}</span>
              <Button size="small" onClick={() => setDecidedLimit((limit) => limit + DECIDED_PAGE)}>{t("Show earlier decisions")}</Button>
            </div>
          )}
        </>
      )}

      <ApprovalRecordDialog
        key={viewing?.id ?? "none"}
        approval={viewing}
        requester={viewing ? resolveRequester(viewing, employees, agents) : ""}
        decider={viewing ? resolveDecider(viewing, employees) : ""}
        drift={viewing ? drifts[viewing.id] ?? null : null}
        onClose={() => setViewingId(null)}
        onOpenTask={openTask}
      />

      {/* Keyed by request, so notes typed for one never carry to another or survive closing. */}
      <ApprovalDetailDialog
        key={editing?.id ?? "none"}
        approval={editing}
        requester={editing ? resolveRequester(editing, employees, agents) : ""}
        onClose={() => setEditingId(null)}
        onDecide={async (state, notes) => {
          if (!editing) return;
          const decidedId = editing.id;
          await decide(editing, state, notes);
          // Close only the request that was decided; another opened meanwhile stays open.
          setEditingId((current) => (current === decidedId ? null : current));
        }}
        onOpenTask={openTask}
      />
    </div>
  );
}

function RiskMenu({ filter, onChange }: { filter: RiskFilter; onChange: (next: RiskFilter) => void }) {
  return (
    <select
      className="button"
      value={filter}
      onChange={(event) => onChange(event.target.value as RiskFilter)}
      style={{ padding: "0 10px" }}
      aria-label={t("Filter risk")}
    >
      {RISK_FILTERS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: "amber" }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="card-label" style={{ marginBottom: 6 }}>{label}</div>
      <div
        className="num"
        style={{ fontSize: 18, fontWeight: 600, color: tone === "amber" ? "var(--amber)" : "var(--text-1)", letterSpacing: "-0.02em" }}
      >
        {value}
      </div>
    </div>
  );
}

function ApprovalRow({
  approval,
  requester,
  isBot,
  onApprove,
  onDecline,
  onReview,
  busy,
  error,
}: {
  approval: ApprovalRecord;
  requester: string;
  isBot: boolean;
  busy: boolean;
  error: string | null;
  onApprove: () => void;
  onDecline: () => void;
  /** Opens the request to read it in full and decide with notes; what is requested is changed at its source. */
  onReview: () => void;
}) {
  const tone = RISK_TONES[approval.risk];
  if (!tone) throw new Error("Approval risk tone is missing.");
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        background: "var(--panel)",
        padding: 18,
        marginBottom: 10,
        display: "grid",
        gridTemplateColumns: "6px minmax(0, 1fr) auto",
        gap: 16,
        alignItems: "flex-start",
      }}
    >
      <div style={{ width: 3, alignSelf: "stretch", background: tone.color, borderRadius: 2 }} />
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: tone.color, fontWeight: 540, letterSpacing: "0.02em" }}>{tone.label}</span>
          <span style={{ color: "var(--text-4)" }}>·</span>
          <Pill>{approvalKindLabel(approval.kind)}</Pill>
        </div>
        <div style={{ fontSize: 15, fontWeight: 540, letterSpacing: "-0.01em", marginBottom: 4 }}>{approval.title}</div>
        <div style={{ fontSize: 14, color: "var(--text-2)", lineHeight: 1.5, marginBottom: 12, whiteSpace: "pre-wrap" }}>
          {approval.details}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Avatar name={requester} size="sm" bot={isBot} />
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>{t("Requested by {requester}", { requester })} · {formatRelative(approval.createdAt)}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
        <Button tone="primary" onClick={onApprove} disabled={busy}>{t("Approve")}</Button>
        <Button onClick={onReview} disabled={busy}>{t("Review")}</Button>
        <Button tone="ghost" onClick={onDecline} disabled={busy}>{t("Decline")}</Button>
        {error && <div className="form-error" role="alert" style={{ maxWidth: 220 }}>{t("Not decided: {reason}", { reason: error })}</div>}
      </div>
    </div>
  );
}

function DecidedRow({
  approval,
  drift,
  requester,
  decider,
  last,
  focused,
  onOpenTask,
  onView,
}: {
  approval: ApprovalRecord;
  drift: ApprovalDrift | null;
  requester: string;
  decider: string;
  last: boolean;
  focused: boolean;
  onOpenTask: (taskId: string) => void;
  onView: () => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focused) rowRef.current?.scrollIntoView({ block: "center" });
  }, [focused]);
  const approved = approval.state === APPROVAL_STATE.APPROVED;
  const superseded = approval.state === APPROVAL_STATE.SUPERSEDED;
  const decidedLabel = approved ? t("Approved") : superseded ? t("Replaced by an edit") : t("Declined");
  return (
    <div
      ref={rowRef}
      className="row"
      aria-current={focused ? "true" : undefined}
      style={{
        gap: 12,
        padding: "12px 18px",
        fontSize: 14,
        borderBottom: last ? "none" : "1px solid var(--border-soft)",
        background: focused ? "var(--accent-soft)" : undefined,
      }}
    >
      <Icon name={approved ? "check" : "x"} color={approved ? "var(--green)" : superseded ? "var(--text-3)" : "var(--red)"} />
      <button
        type="button"
        className="link-button"
        aria-label={t("View record of {title}", { title: approval.title })}
        onClick={onView}
        style={{ flex: 1, fontWeight: 480, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}
      >
        {approval.title}
      </button>
      {approval.sourceEntityType === "task" && approval.sourceEntityId && (
        <button type="button" className="link-button" style={{ fontSize: 12 }} onClick={() => onOpenTask(approval.sourceEntityId!)}>{t("Open task")}</button>
      )}
      {drift && <Pill tone="amber">{drift === "changed" ? t("Changed since approval") : t("Removed since approval")}</Pill>}
      <Avatar name={requester} size="sm" bot />
      <div style={{ fontSize: 12, color: "var(--text-3)", width: 180, textAlign: "right", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {decidedLabel} · {formatRelative(approval.decidedAt ?? approval.createdAt)}{superseded ? "" : ` · ${decider.split(" ")[0]}`}
      </div>
    </div>
  );
}

function resolveRequester(approval: ApprovalRecord, employees: EmployeeRecord[], agents: AgentRecord[]): string {
  if (approval.requestedByType === "employee" && approval.requestedById) {
    return employees.find((item) => item.id === approval.requestedById)?.displayName ?? t("Unknown");
  }
  if (approval.requestedByType === "agent" && approval.requestedById) {
    return agents.find((item) => item.id === approval.requestedById)?.name ?? t("Agent");
  }
  return t("System");
}

function resolveDecider(approval: ApprovalRecord, employees: EmployeeRecord[]): string {
  if (!approval.decidedByEmployeeId) return "—";
  return employees.find((item) => item.id === approval.decidedByEmployeeId)?.displayName ?? t("Unknown");
}

function withinDays(iso: string | null, days: number): boolean {
  if (!iso) return false;
  const target = new Date(iso).getTime();
  return Date.now() - target < days * 24 * 60 * 60 * 1000;
}

function computeMedianMinutes(approvals: ApprovalRecord[]): number {
  const intervals = approvals
    .map((approval) => approval.decidedAt ? new Date(approval.decidedAt).getTime() - new Date(approval.createdAt).getTime() : null)
    .filter((interval): interval is number => interval !== null && interval > 0)
    .map((interval) => Math.round(interval / 60_000))
    .sort((a, b) => a - b);
  if (intervals.length === 0) return 0;
  const mid = Math.floor(intervals.length / 2);
  const lower = intervals[mid - 1];
  const higher = intervals[mid];
  if (intervals.length % 2 === 1) return higher ?? 0;
  if (lower === undefined || higher === undefined) return 0;
  return Math.round((lower + higher) / 2);
}

function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "—";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining === 0 ? `${hours}h` : `${hours}h ${remaining}m`;
}

/** What a batch approval did: how many were approved, and each that was not, with why. */
function BatchSummary({ total, result, onDismiss }: { total: number; result: BatchResult; onDismiss: () => void }) {
  return (
    <div role="status" className="card" style={{ padding: 14, marginBottom: 16 }}>
      <div className="row" style={{ gap: 8 }}>
        <span style={{ fontWeight: 600 }}>{t("Approved {n} of {total}.", { n: result.approved.length, total })}</span>
        <span style={{ marginLeft: "auto" }}><Button size="small" tone="ghost" onClick={onDismiss}>{t("Dismiss")}</Button></span>
      </div>
      {result.failed.map((failure) => (
        <div key={failure.id} className="form-error">{failure.title}: {failure.reason}</div>
      ))}
    </div>
  );
}
