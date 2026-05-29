import { Avatar, Pill } from "../../shared/ui";
import type { AuditEventRecord, EmployeeRecord } from "../../../../shared/domain";
import { formatRelative, humanizeToken } from "../types";

export function ProfilePanel({ employee }: { employee: EmployeeRecord }) {
  return (
    <div className="page">
      <h1 className="page-h1">Profile</h1>
      <p className="page-sub">Your identity in this workspace.</p>
      <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="row" style={{ gap: 14 }}>
          <Avatar name={employee.displayName} size="xl" />
          <div>
            <div style={{ fontSize: 18, fontWeight: 620 }}>{employee.displayName}</div>
            <div style={{ color: "var(--text-3)" }}>{employee.role}</div>
          </div>
        </div>
        <div className="row">
          <span className="card-label" style={{ width: 140 }}>Joined</span>
          <span className="mono" style={{ color: "var(--text-2)" }}>{new Date(employee.createdAt).toLocaleDateString()}</span>
        </div>
        <div className="row">
          <span className="card-label" style={{ width: 140 }}>Employee ID</span>
          <span className="mono" style={{ color: "var(--text-2)" }}>{employee.id}</span>
        </div>
      </div>
    </div>
  );
}

export function NotificationsPanel({ events, employee }: { events: AuditEventRecord[]; employee: EmployeeRecord }) {
  const visible = events.filter((event) => event.actorId === employee.id || event.actorType === "system").slice(0, 40);
  return (
    <div className="page">
      <h1 className="page-h1">Notifications</h1>
      <p className="page-sub">Real audit events flagged for you.</p>
      {visible.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {visible.map((event, index) => (
            <div
              key={event.id}
              className="row"
              style={{ padding: "12px 18px", borderBottom: index === visible.length - 1 ? "none" : "1px solid var(--border-soft)" }}
            >
              <Pill>{event.entityType.replaceAll("_", " ")}</Pill>
              <span style={{ flex: 1, fontWeight: 480, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{humanizeToken(event.action)}</span>
              <span style={{ color: "var(--text-3)", fontSize: 12 }}>{formatRelative(event.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SecurityPanel({ events }: { events: AuditEventRecord[] }) {
  const security = events.filter((event) => isSecurityEvent(event.action, event.entityType)).slice(0, 50);
  return (
    <div className="page">
      <h1 className="page-h1">Security</h1>
      <p className="page-sub">Recent security-relevant audit events.</p>
      {security.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {security.map((event, index) => (
            <div
              key={event.id}
              className="row"
              style={{ padding: "12px 18px", borderBottom: index === security.length - 1 ? "none" : "1px solid var(--border-soft)" }}
            >
              <Pill tone="amber">{event.entityType.replaceAll("_", " ")}</Pill>
              <span style={{ flex: 1, fontWeight: 480, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{humanizeToken(event.action)}</span>
              <span style={{ color: "var(--text-3)", fontSize: 12 }}>{formatRelative(event.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function isSecurityEvent(action: string, entityType: string): boolean {
  return (
    action.includes("credential") ||
    action.includes("login") ||
    entityType.includes("approval") ||
    entityType.includes("policy")
  );
}
