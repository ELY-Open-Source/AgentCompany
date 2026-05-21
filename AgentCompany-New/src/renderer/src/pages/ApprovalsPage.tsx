import { Avatar, Button, Icon, Pill } from "../shared/ui";
import type { AgentRecord, ApprovalRecord, EmployeeRecord } from "../../../shared/domain";
import type { PageProps } from "./types";
import { activeOrgId } from "./types";

export function ApprovalsPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const employee = snapshot.employees.find((item) => item.orgId === orgId);
  const employees = snapshot.employees.filter((item) => item.orgId === orgId);
  const agents = snapshot.agents.filter((item) => item.orgId === orgId);
  const approvals = snapshot.approvals.filter((item) => item.orgId === orgId);
  const pending = approvals.filter((item) => item.state === "pending");
  const decided = approvals.filter((item) => item.state !== "pending");

  const decide = (approvalId: string, state: "approved" | "declined") => {
    if (!employee) throw new Error("Employee is required for approval decisions.");
    void actions.run(() => window.agentCompany.decideApproval({
      orgId,
      approvalId,
      state,
      decidedByEmployeeId: employee.id,
    }));
  };

  return (
    <div className="page">
      <h1 className="page-h1">Approvals</h1>
      <p className="page-sub">{pending.length} pending · {decided.length} decided</p>
      <div className="grid-4" style={{ marginBottom: 24 }}>
        <StatTile label="Pending" value={String(pending.length)} tone="amber" />
        <StatTile label="Approved" value={String(decided.filter((item) => item.state === "approved").length)} />
        <StatTile label="Declined" value={String(decided.filter((item) => item.state === "declined").length)} />
        <StatTile label="High risk" value={String(pending.filter((item) => item.risk === "high").length)} />
      </div>
      <div className="section-label">Pending</div>
      {pending.length === 0 ? (
        <div className="card" style={{ color: "var(--text-3)" }}>No pending approvals</div>
      ) : pending.map((approval) => (
        <ApprovalRow
          key={approval.id}
          approval={approval}
          requester={requesterName(approval, employees, agents)}
          onApprove={() => decide(approval.id, "approved")}
          onDecline={() => decide(approval.id, "declined")}
        />
      ))}
      <div className="section-label" style={{ marginTop: 32 }}>Decided</div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {decided.length === 0 ? (
          <div style={{ padding: 18, color: "var(--text-3)" }}>No decisions</div>
        ) : decided.map((approval) => (
          <div key={approval.id} className="table-row" style={{ gridTemplateColumns: "24px 1fr 120px" }}>
            <Icon name="check" />
            <span>{approval.title}</span>
            <Pill tone={approval.state === "approved" ? "green" : "amber"}>{approval.state}</Pill>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: "amber" }) {
  return (
    <div className="card">
      <div className="card-label" style={{ marginBottom: 6 }}>{label}</div>
      <div className="num" style={{ fontSize: 22, fontWeight: 600, color: tone === "amber" ? "var(--amber)" : "var(--text-1)" }}>{value}</div>
    </div>
  );
}

function ApprovalRow({
  approval,
  requester,
  onApprove,
  onDecline,
}: {
  approval: ApprovalRecord;
  requester: string;
  onApprove: () => void;
  onDecline: () => void;
}) {
  const riskColor = approval.risk === "high" ? "var(--red)" : approval.risk === "medium" ? "var(--amber)" : "var(--text-3)";
  return (
    <div className="card" style={{ marginBottom: 10, display: "grid", gridTemplateColumns: "6px 1fr auto", gap: 16 }}>
      <div style={{ width: 3, alignSelf: "stretch", background: riskColor, borderRadius: 2 }} />
      <div>
        <div className="row" style={{ marginBottom: 4 }}>
          <span style={{ color: riskColor, fontSize: 11, fontWeight: 540 }}>{approval.risk}</span>
          <Pill>{approval.kind}</Pill>
        </div>
        <div style={{ fontSize: 15, fontWeight: 540, marginBottom: 4 }}>{approval.title}</div>
        <div style={{ color: "var(--text-2)", lineHeight: 1.5, marginBottom: 12 }}>{approval.details}</div>
        <div className="row">
          <Avatar name={requester} size="sm" bot={approval.requestedByType !== "employee"} />
          <span style={{ color: "var(--text-3)", fontSize: 12 }}>{requester}</span>
          <span style={{ color: "var(--text-3)", fontSize: 12 }}>{new Date(approval.createdAt).toLocaleString()}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
        <Button tone="primary" onClick={onApprove}>Approve</Button>
        <Button tone="ghost" onClick={onDecline}>Decline</Button>
      </div>
    </div>
  );
}

function requesterName(
  approval: ApprovalRecord,
  employees: EmployeeRecord[],
  agents: AgentRecord[],
): string {
  if (approval.requestedByType === "employee") {
    const employee = employees.find((item) => item.id === approval.requestedById);
    if (!employee) throw new Error("Approval employee requester is missing.");
    return employee.displayName;
  }
  if (approval.requestedByType === "agent") {
    const agent = agents.find((item) => item.id === approval.requestedById);
    if (!agent) throw new Error("Approval agent requester is missing.");
    return agent.name;
  }
  return "System";
}
