import { useMemo, useState } from "react";
import { Avatar, Button, Icon, IconButton, Pill } from "../shared/ui";
import { TopbarActions } from "../shared/TopbarActions";
import type {
  AgentRecord,
  ApprovalRecord,
  EmployeeRecord,
  RiskLevel,
} from "../../../shared/domain";
import { APPROVAL_STATE, RISK_LEVEL } from "../../../shared/domain";
import type { PageProps } from "./types";
import { activeOrgId, formatRelative, requireActiveEmployee } from "./types";

type RiskFilter = "all" | RiskLevel;

const RISK_FILTERS: ReadonlyArray<{ id: RiskFilter; label: string }> = [
  { id: "all", label: "All risk" },
  { id: RISK_LEVEL.HIGH, label: "High" },
  { id: RISK_LEVEL.MEDIUM, label: "Medium" },
  { id: RISK_LEVEL.LOW, label: "Low" },
];

const RISK_TONES: Record<RiskLevel, { label: string; color: string }> = {
  [RISK_LEVEL.HIGH]: { label: "High risk", color: "var(--red)" },
  [RISK_LEVEL.MEDIUM]: { label: "Medium risk", color: "var(--amber)" },
  [RISK_LEVEL.LOW]: { label: "Low risk", color: "var(--text-3)" },
};

export function ApprovalsPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const employee = requireActiveEmployee(snapshot);
  const [filter, setFilter] = useState<RiskFilter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);

  const approvals = useMemo(() => snapshot.approvals.filter((item) => item.orgId === orgId), [snapshot.approvals, orgId]);
  const employees = snapshot.employees.filter((item) => item.orgId === orgId);
  const agents = snapshot.agents.filter((item) => item.orgId === orgId);

  const pending = approvals.filter((approval) => approval.state === APPROVAL_STATE.PENDING);
  const decided = approvals.filter((approval) => approval.state !== APPROVAL_STATE.PENDING);
  const filteredPending = filter === "all" ? pending : pending.filter((approval) => approval.risk === filter);
  const weeklyDecided = decided.filter((approval) => withinDays(approval.decidedAt, 7));
  const approved7d = weeklyDecided.filter((approval) => approval.state === APPROVAL_STATE.APPROVED).length;
  const declined7d = weeklyDecided.filter((approval) => approval.state === APPROVAL_STATE.DECLINED).length;
  const medianTime = computeMedianMinutes(weeklyDecided);

  const editing = editingId ? approvals.find((approval) => approval.id === editingId) ?? null : null;

  const decide = (approval: ApprovalRecord, state: "approved" | "declined") => {
    setEditingId(null);
    void actions.run(() => window.agentCompany.decideApproval({
      orgId,
      approvalId: approval.id,
      state,
      decidedByEmployeeId: employee.id,
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
        <Button tone="primary" onClick={approveAllLowRisk}>Approve all low risk</Button>
      </TopbarActions>
      <h1 className="page-h1">Approvals</h1>
      <p className="page-sub">
        {pending.length} pending · {approved7d} approved this week
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
        <StatTile label="Pending" value={String(pending.length)} tone="amber" />
        <StatTile label="Median time" value={formatMinutes(medianTime)} />
        <StatTile label="Approved (7d)" value={String(approved7d)} />
        <StatTile label="Declined (7d)" value={String(declined7d)} />
      </div>

      {filteredPending.length > 0 && <div className="section-label" style={{ marginBottom: 10 }}>Pending</div>}
      {filteredPending.map((approval) => (
        <ApprovalRow
          key={approval.id}
          approval={approval}
          requester={resolveRequester(approval, employees, agents)}
          isBot={approval.requestedByType === "agent"}
          onApprove={() => decide(approval, "approved")}
          onDecline={() => decide(approval, "declined")}
          onEdit={() => setEditingId(approval.id)}
        />
      ))}

      {decided.length > 0 && (
        <>
          <div className="section-label" style={{ margin: "32px 0 10px" }}>Recently decided</div>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {decided.slice(0, 24).map((approval, index) => (
              <DecidedRow
                key={approval.id}
                approval={approval}
                requester={resolveRequester(approval, employees, agents)}
                decider={resolveDecider(approval, employees)}
                last={index === Math.min(decided.length, 24) - 1}
              />
            ))}
          </div>
        </>
      )}

      <ApprovalDetailDialog
        approval={editing}
        requester={editing ? resolveRequester(editing, employees, agents) : ""}
        onClose={() => setEditingId(null)}
        onApprove={() => editing && decide(editing, "approved")}
        onDecline={() => editing && decide(editing, "declined")}
      />
    </div>
  );
}

function ApprovalDetailDialog({
  approval,
  requester,
  onClose,
  onApprove,
  onDecline,
}: {
  approval: ApprovalRecord | null;
  requester: string;
  onClose: () => void;
  onApprove: () => void;
  onDecline: () => void;
}) {
  if (!approval) return null;
  const tone = RISK_TONES[approval.risk];
  if (!tone) throw new Error("Approval risk tone is missing.");
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label={approval.title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="row" style={{ alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
          <h2 className="modal-title" style={{ margin: 0, flex: 1 }}>{approval.title}</h2>
          <IconButton icon="x" label="Close" onClick={onClose} />
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          <span style={{ fontSize: 11, color: tone.color, fontWeight: 540, letterSpacing: "0.02em" }}>{tone.label}</span>
          <span style={{ color: "var(--text-4)" }}>·</span>
          <Pill>{approval.kind}</Pill>
        </div>
        <p style={{ margin: "0 0 16px", color: "var(--text-2)", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
          {approval.details}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "10px 14px", fontSize: 12.5 }}>
          <span style={{ color: "var(--text-3)" }}>Requested by</span>
          <span>{requester}</span>
          {approval.sourceEntityType && (<><span style={{ color: "var(--text-3)" }}>Source</span><span>{humanizeKind(approval.sourceEntityType)}</span></>)}
          <span style={{ color: "var(--text-3)" }}>Requested</span>
          <span>{formatRelative(approval.createdAt)}</span>
        </div>
        <div className="modal-actions">
          <Button onClick={onDecline}>Decline</Button>
          <Button tone="primary" onClick={onApprove}>Approve</Button>
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
      aria-label="Filter risk"
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
        style={{ fontSize: 22, fontWeight: 600, color: tone === "amber" ? "var(--amber)" : "var(--text-1)", letterSpacing: "-0.02em" }}
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
  onEdit,
}: {
  approval: ApprovalRecord;
  requester: string;
  isBot: boolean;
  onApprove: () => void;
  onDecline: () => void;
  onEdit: () => void;
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
          <span style={{ fontSize: 11, color: tone.color, fontWeight: 540, letterSpacing: "0.02em" }}>{tone.label}</span>
          <span style={{ color: "var(--text-4)" }}>·</span>
          <Pill>{approval.kind}</Pill>
        </div>
        <div style={{ fontSize: 15, fontWeight: 540, letterSpacing: "-0.01em", marginBottom: 4 }}>{approval.title}</div>
        <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5, marginBottom: 12, whiteSpace: "pre-wrap" }}>
          {approval.details}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Avatar name={requester} size="sm" bot={isBot} />
          <span style={{ fontSize: 12, color: "var(--text-3)" }}>Requested by {requester} · {formatRelative(approval.createdAt)}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
        <Button tone="primary" onClick={onApprove}>Approve</Button>
        <Button onClick={onEdit}>Edit</Button>
        <Button tone="ghost" onClick={onDecline}>Decline</Button>
      </div>
    </div>
  );
}

function DecidedRow({
  approval,
  requester,
  decider,
  last,
}: {
  approval: ApprovalRecord;
  requester: string;
  decider: string;
  last: boolean;
}) {
  const approved = approval.state === APPROVAL_STATE.APPROVED;
  const decidedLabel = approved ? "Approved" : "Declined";
  return (
    <div
      className="row"
      style={{
        gap: 12,
        padding: "12px 18px",
        fontSize: 13,
        borderBottom: last ? "none" : "1px solid var(--border-soft)",
      }}
    >
      <Icon name={approved ? "check" : "x"} size={14} color={approved ? "var(--green)" : "var(--red)"} />
      <div style={{ flex: 1, fontWeight: 480, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{approval.title}</div>
      <Avatar name={requester} size="sm" bot />
      <div style={{ fontSize: 12, color: "var(--text-3)", width: 180, textAlign: "right", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {decidedLabel} · {formatRelative(approval.decidedAt ?? approval.createdAt)} · {decider.split(" ")[0]}
      </div>
    </div>
  );
}

function resolveRequester(approval: ApprovalRecord, employees: EmployeeRecord[], agents: AgentRecord[]): string {
  if (approval.requestedByType === "employee" && approval.requestedById) {
    return employees.find((item) => item.id === approval.requestedById)?.displayName ?? "Unknown";
  }
  if (approval.requestedByType === "agent" && approval.requestedById) {
    return agents.find((item) => item.id === approval.requestedById)?.name ?? "Agent";
  }
  return "System";
}

function resolveDecider(approval: ApprovalRecord, employees: EmployeeRecord[]): string {
  if (!approval.decidedByEmployeeId) return "—";
  return employees.find((item) => item.id === approval.decidedByEmployeeId)?.displayName ?? "Unknown";
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
