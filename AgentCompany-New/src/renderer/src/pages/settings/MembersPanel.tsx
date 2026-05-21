import { Avatar, Pill } from "../../shared/ui";
import type { AgentRecord, EmployeeRecord } from "../../../../shared/domain";
import { money } from "../types";

export function MembersPanel({
  employees,
  agents,
}: {
  employees: EmployeeRecord[];
  agents: AgentRecord[];
}) {
  const total = employees.length + agents.length;
  return (
    <div className="page">
      <h1 className="page-h1">Members</h1>
      <p className="page-sub">
        {total} {total === 1 ? "member" : "members"} · {employees.length} {employees.length === 1 ? "human" : "humans"} · {agents.length} {agents.length === 1 ? "agent" : "agents"}
      </p>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div
          className="table-row head"
          style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)" }}
        >
          <div>Member</div><div>Type</div><div>Department</div><div>Budget</div>
        </div>
        {employees.map((employee) => (
          <div
            key={employee.id}
            className="table-row"
            style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)" }}
          >
            <div className="row" style={{ gap: 10 }}>
              <Avatar name={employee.displayName} size="sm" />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{employee.displayName}</div>
                <div style={{ fontSize: 11, color: "var(--text-3)" }}>{employee.role}</div>
              </div>
            </div>
            <div><Pill>Human</Pill></div>
            <div style={{ color: "var(--text-2)" }}>Executive</div>
            <div style={{ color: "var(--text-4)" }}>—</div>
          </div>
        ))}
        {agents.map((agent, index) => (
          <div
            key={agent.id}
            className="table-row"
            style={{
              gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)",
              borderBottom: index === agents.length - 1 ? "none" : undefined,
            }}
          >
            <div className="row" style={{ gap: 10 }}>
              <Avatar name={agent.name} size="sm" bot />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{agent.name}</div>
                <div style={{ fontSize: 11, color: "var(--text-3)" }}>{agent.role}</div>
              </div>
            </div>
            <div><Pill tone="violet" dot>Agent</Pill></div>
            <div style={{ color: "var(--text-2)" }}>{agent.department}</div>
            <div className="num mono" style={{ color: "var(--text-2)" }}>{money(agent.budgetCents)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
