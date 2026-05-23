import { Pill } from "../../shared/ui";
import type {
  AgentRecord,
  ApprovalAssignmentRecord,
  ApprovalRoutingRuleRecord,
  EmployeeRecord,
  HiringPolicyRecord,
  OrgDepartmentRecord,
  PolicyRuleRecord,
} from "../../../../shared/domain";
import { money } from "../types";

export function PoliciesPanel({
  policies,
  agents,
  employees,
  orgDepartments,
  hiringPolicies,
  approvalRoutingRules,
  approvalAssignments,
}: {
  policies: PolicyRuleRecord[];
  agents: AgentRecord[];
  employees: EmployeeRecord[];
  orgDepartments: OrgDepartmentRecord[];
  hiringPolicies: HiringPolicyRecord[];
  approvalRoutingRules: ApprovalRoutingRuleRecord[];
  approvalAssignments: ApprovalAssignmentRecord[];
}) {
  return (
    <div className="page">
      <h1 className="page-h1">Policies</h1>
      <p className="page-sub">Policy rules evaluated for actions across the workspace.</p>
      <div className="section-label" style={{ marginBottom: 10 }}>Rules</div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div
          className="table-row head"
          style={{ gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr)" }}
        >
          <div>Action</div><div>Effect</div><div>Risk ceiling</div><div>Subject</div>
        </div>
        {policies.map((policy, index) => (
          <div
            key={policy.id}
            className="table-row"
            style={{ gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr)", borderBottom: index === policies.length - 1 ? "none" : "1px solid var(--border-soft)" }}
          >
            <div style={{ fontWeight: 540 }}>{policy.action.replaceAll("_", " ")}</div>
            <div><Pill>{policy.effect.replaceAll("_", " ")}</Pill></div>
            <div>
              <Pill tone={policy.riskCeiling === "high" ? "red" : policy.riskCeiling === "medium" ? "amber" : undefined}>
                {policy.riskCeiling}
              </Pill>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-3)" }}>{policy.subjectType}</div>
          </div>
        ))}
      </div>

      <div className="section-label" style={{ margin: "24px 0 10px" }}>Hiring policies</div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div
          className="table-row head"
          style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1fr)" }}
        >
          <div>Department</div><div>Headcount</div><div>Budget cap</div><div>Review</div>
        </div>
        {hiringPolicies.map((policy, index) => (
          <HiringPolicyRow
            key={policy.id}
            policy={policy}
            department={orgDepartments.find((item) => item.name === policy.departmentName) ?? null}
            agents={agents}
            last={index === hiringPolicies.length - 1}
          />
        ))}
      </div>

      <div className="section-label" style={{ margin: "24px 0 10px" }}>Review routing</div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div
          className="table-row head"
          style={{ gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1fr)" }}
        >
          <div>Kind</div><div>Min risk</div><div>Route</div><div>Assigned</div>
        </div>
        {approvalRoutingRules.map((rule, index) => (
          <RoutingRuleRow
            key={rule.id}
            rule={rule}
            employees={employees}
            agents={agents}
            assignmentCount={approvalAssignments.filter((assignment) => assignment.routingRuleId === rule.id).length}
            last={index === approvalRoutingRules.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

function HiringPolicyRow({
  policy,
  department,
  agents,
  last,
}: {
  policy: HiringPolicyRecord;
  department: OrgDepartmentRecord | null;
  agents: AgentRecord[];
  last: boolean;
}) {
  if (!department) throw new Error(`Department governance is missing for ${policy.departmentName}.`);
  const roster = agents.filter((agent) => agent.department === policy.departmentName && agent.lifecycle === "active");
  const budgetCents = roster.reduce((sum, agent) => sum + agent.budgetCents, 0);
  return (
    <div
      className="table-row"
      style={{
        gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1fr)",
        borderBottom: last ? "none" : "1px solid var(--border-soft)",
      }}
    >
      <div style={{ fontWeight: 540 }}>{policy.departmentName}</div>
      <div className="num mono">{roster.length} / {department.headcountLimit}</div>
      <div className="num mono">{money(budgetCents)} / {money(policy.monthlyBudgetLimitCents)}</div>
      <div><Pill>{money(policy.requireApprovalAboveCents)}</Pill></div>
    </div>
  );
}

function RoutingRuleRow({
  rule,
  employees,
  agents,
  assignmentCount,
  last,
}: {
  rule: ApprovalRoutingRuleRecord;
  employees: EmployeeRecord[];
  agents: AgentRecord[];
  assignmentCount: number;
  last: boolean;
}) {
  return (
    <div
      className="table-row"
      style={{
        gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1fr)",
        borderBottom: last ? "none" : "1px solid var(--border-soft)",
      }}
    >
      <div style={{ fontWeight: 540 }}>{rule.kind}</div>
      <div><Pill tone={rule.minimumRisk === "high" ? "red" : rule.minimumRisk === "medium" ? "amber" : undefined}>{rule.minimumRisk}</Pill></div>
      <div style={{ color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {routeLabel(rule, employees, agents)}
      </div>
      <div className="num mono">{assignmentCount}</div>
    </div>
  );
}

function routeLabel(rule: ApprovalRoutingRuleRecord, employees: EmployeeRecord[], agents: AgentRecord[]): string {
  if (rule.routeToType === "board") return "Board";
  if (rule.routeToType === "employee") {
    const employee = employees.find((item) => item.id === rule.routeToId);
    if (!employee) throw new Error("Approval route employee is missing.");
    return employee.displayName;
  }
  const agent = agents.find((item) => item.id === rule.routeToId);
  if (!agent) throw new Error("Approval route agent is missing.");
  return agent.name;
}
