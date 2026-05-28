import { Avatar, Pill } from "../../shared/ui";
import type { AgentRecord, EmployeeIdentityRecord, EmployeeRecord, RoleGrantRecord, ServiceIdentityRecord } from "../../../../shared/domain";
import { money } from "../types";

export function MembersPanel({
  employees,
  agents,
  employeeIdentities,
  serviceIdentities,
  roleGrants,
}: {
  employees: EmployeeRecord[];
  agents: AgentRecord[];
  employeeIdentities: EmployeeIdentityRecord[];
  serviceIdentities: ServiceIdentityRecord[];
  roleGrants: RoleGrantRecord[];
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
            <div style={{ color: "var(--text-4)" }}>—</div>
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
      <div className="section-label" style={{ margin: "24px 0 10px" }}>Identity & Access</div>
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div
          className="table-row head"
          style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1.2fr) minmax(0, 1.8fr)" }}
        >
          <div>Principal</div><div>Identity source</div><div>Roles</div>
        </div>
        {employees.map((employee, index) => (
          <AccessRow
            key={employee.id}
            name={employee.displayName}
            detail={employee.role}
            source={identitySource(employee.id, employeeIdentities)}
            roles={principalRoles("employee", employee.id, roleGrants)}
            bot={false}
            last={agents.length === 0 && index === employees.length - 1}
          />
        ))}
        {agents.map((agent, index) => {
          const serviceIdentity = serviceIdentities.find((identity) => identity.agentId === agent.id);
          return (
            <AccessRow
              key={agent.id}
              name={agent.name}
              detail={agent.department}
              source={serviceIdentity ? "Service identity" : "Agent"}
              roles={serviceIdentity ? principalRoles("service_identity", serviceIdentity.id, roleGrants) : []}
              bot
              last={index === agents.length - 1}
            />
          );
        })}
      </div>
    </div>
  );
}

function AccessRow({
  name,
  detail,
  source,
  roles,
  bot,
  last,
}: {
  name: string;
  detail: string;
  source: string;
  roles: string[];
  bot: boolean;
  last: boolean;
}) {
  return (
    <div
      className="table-row"
      style={{
        gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1.2fr) minmax(0, 1.8fr)",
        borderBottom: last ? "none" : "1px solid var(--border-soft)",
      }}
    >
      <div className="row" style={{ gap: 10, minWidth: 0 }}>
        <Avatar name={name} size="sm" bot={bot} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail}</div>
        </div>
      </div>
      <div style={{ color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{source}</div>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {roles.map((role) => <Pill key={role}>{role}</Pill>)}
      </div>
    </div>
  );
}

function identitySource(employeeId: string, identities: EmployeeIdentityRecord[]): string {
  const identity = identities.find((item) => item.employeeId === employeeId && item.active);
  if (!identity) return "Unlinked";
  if (identity.source === "sso") return "SSO";
  if (identity.source === "scim") return "SCIM";
  return "Bootstrap";
}

function principalRoles(principalType: RoleGrantRecord["principalType"], principalId: string, grants: RoleGrantRecord[]): string[] {
  return grants
    .filter((grant) => grant.principalType === principalType && grant.principalId === principalId)
    .map((grant) => grant.roleKey.replaceAll("_", " "))
    .sort();
}
