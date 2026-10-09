import { decidedWindow } from "./approvals/decided-window";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, Button, Icon, IconButton, Pill } from "../shared/ui";
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

const RISK_FILTERS: ReadonlyArray<{ id: RiskFilter; label: string }> = [
  { id: "all", label: t("All risk") },
  { id: RISK_LEVEL.HIGH, label: t("High") },
  { id: RISK_LEVEL.MEDIUM, label: t("Medium") },
  { id: RISK_LEVEL.LOW, label: t("Low") },
];

const RISK_TONES: Record<RiskLevel, { label: string; color: string }> = {
  [RISK_LEVEL.HIGH]: { label: t("High risk"), color: "var(--red)" },
  [RISK_LEVEL.MEDIUM]: { label: t("Medium risk"), color: "var(--amber)" },
  [RISK_LEVEL.LOW]: { label: t("Low risk"), color: "var(--text-3)" },
};

export function ApprovalsPage({ snapshot, actions, navigate, focus }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const employee = requireActiveEmployee(snapshot);
  const [filter, setFilter] = useState<RiskFilter>("all");
  const focusedApproval = focus?.kind === "approval" ? focus.id : null;
  const [editingId, setEditingId] = useState<string | null>(
    focusedApproval && snapshot.approvals.some((item) => item.id === focusedApproval && item.state === "pending") ? focusedApproval : null,
  );
  const openTask = (taskId: string) => navigate("work", { kind: "task", id: taskId });

  const approvals = useMemo(() => snapshot.approvals.filter((item) => item.orgId === orgId), [snapshot.approvals, orgId]);
  const employees = snapshot.employees.filter((item) => item.orgId === orgId);
  const agents = snapshot.agents.filter((item) => item.orgId === orgId);

  const pending = approvals.filter((approval) => approval.state === APPROVAL_STATE.PENDING);
  const decided = approvals.filter((approval) => approval.state !== APPROVAL_STATE.PENDING);
  const shownDecided = decidedWindow(decided, focusedApproval);
  const filteredPending = filter === "all" ? pending : pending.filter((approval) => approval.risk === filter);
  const weeklyDecided = decided.filter((approval) => withinDays(approval.decidedAt, 7));
  const approved7d = weeklyDecided.filter((approval) => approval.state === APPROVAL_STATE.APPROVED).length;
  const declined7d = weeklyDecided.filter((approval) => approval.state === APPROVAL_STATE.DECLINED).length;
  const medianTime = computeMedianMinutes(weeklyDecided);

  const editing = editingId ? approvals.find((approval) => approval.id === editingId) ?? null : null;

  // Drift is read from disk in the main process, again whenever the approvals change.
  const [drifts, setDrifts] = useState<Record<string, ApprovalDrift>>({});
  const [driftError, setDriftError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void window.agentCompany.approvalDrifts({ orgId }).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setDrifts(result.data);
        setDriftError(null);
      } else {
        setDriftError(result.error.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [orgId, approvals]);

  const decide = (approval: ApprovalRecord, state: "approved" | "declined", notes?: string) => {
    setEditingId(null);
    void actions.run(() => window.agentCompany.decideApproval({
      orgId,
      approvalId: approval.id,
      state,
      decidedByEmployeeId: employee.id,
      notes,
    }));
  };

  const approveAllLowRisk = () => {
    const lows = filteredPending.filter((approval) => approval.risk === RISK_LEVEL.LOW);
    for (const approval of lows) decide(approval, "approved");
  };

  return (
    <div className="page">
      <TopbarActions>
        <RiskMenu filter={filter} onChange={setFilter} />
        <Button tone="primary" onClick={approveAllLowRisk}>{t("Approve all low risk")}</Button>
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

      {filteredPending.length > 0 && <div className="section-label" style={{ marginBottom: 10 }}>{t("Pending")}</div>}
      {filteredPending.map((approval) => (
        <ApprovalRow
          key={approval.id}
          approval={approval}
          requester={resolveRequester(approval, employees, agents)}
          isBot={approval.requestedByType === "agent"}
          onApprove={() => decide(approval, "approved")}
          onDecline={() => decide(approval, "declined")}
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
              />
            ))}
          </div>
        </>
      )}

      <ApprovalDetailDialog
        approval={editing}
        requester={editing ? resolveRequester(editing, employees, agents) : ""}
        onClose={() => setEditingId(null)}
        onDecide={(state, notes) => editing && decide(editing, state, notes)}
        onOpenTask={openTask}
      />
    </div>
  );
}

function ApprovalDetailDialog({
  approval,
  requester,
  onClose,
  onDecide,
  onOpenTask,
}: {
  approval: ApprovalRecord | null;
  requester: string;
  onClose: () => void;
  onDecide: (state: "approved" | "declined", notes?: string) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const [notes, setNotes] = useState("");
  if (!approval) return null;
  const tone = RISK_TONES[approval.risk];
  if (!tone) throw new Error("Approval risk tone is missing.");
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label={approval.title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="row" style={{ alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
          <h2 className="modal-title" style={{ margin: 0, flex: 1 }}>{approval.title}</h2>
          <IconButton icon="x" label={t("Close")} onClick={onClose} />
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          <span style={{ fontSize: 12, color: tone.color, fontWeight: 540, letterSpacing: "0.02em" }}>{tone.label}</span>
          <span style={{ color: "var(--text-4)" }}>·</span>
          <Pill>{approval.kind}</Pill>
        </div>
        <p style={{ margin: "0 0 16px", color: "var(--text-2)", fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
          {approval.details}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "10px 14px", fontSize: 12 }}>
          <span style={{ color: "var(--text-3)" }}>{t("Requested by")}</span>
          <span>{requester}</span>
          {approval.sourceEntityType && (
            <>
              <span style={{ color: "var(--text-3)" }}>{t("Source")}</span>
              {approval.sourceEntityType === "task" && approval.sourceEntityId
                ? (
                  <span>
                    <button type="button" className="link-button" onClick={() => onOpenTask(approval.sourceEntityId!)}>{t("Edit the task")}</button>
                    <span style={{ color: "var(--text-3)" }}> · {t("Changing the task replaces this request with a fresh one.")}</span>
                  </span>
                )
                : <span>{humanizeKind(approval.sourceEntityType)}</span>}
            </>
          )}
          <span style={{ color: "var(--text-3)" }}>{t("Requested")}</span>
          <span>{formatRelative(approval.createdAt)}</span>
        </div>
        <textarea
          className="input"
          aria-label={t("Decision notes")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          style={{ marginTop: 14 }}
        />
        <div className="modal-actions">
          <Button onClick={() => onDecide("declined", notes || undefined)}>{t("Decline")}</Button>
          <Button tone="primary" onClick={() => onDecide("approved", notes || undefined)}>{t("Approve")}</Button>
        </div>
      </div>
    </div>
  );
}

function humanizeKind(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
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
}: {
  approval: ApprovalRecord;
  requester: string;
  isBot: boolean;
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
          <Pill>{approval.kind}</Pill>
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
        <Button tone="primary" onClick={onApprove}>{t("Approve")}</Button>
        <Button onClick={onReview}>{t("Review")}</Button>
        <Button tone="ghost" onClick={onDecline}>{t("Decline")}</Button>
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
}: {
  approval: ApprovalRecord;
  drift: ApprovalDrift | null;
  requester: string;
  decider: string;
  last: boolean;
  focused: boolean;
  onOpenTask: (taskId: string) => void;
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
      <Icon name={approved ? "check" : "x"} size={14} color={approved ? "var(--green)" : superseded ? "var(--text-3)" : "var(--red)"} />
      <div style={{ flex: 1, fontWeight: 480, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{approval.title}</div>
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
