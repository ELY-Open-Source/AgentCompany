import { Pill } from "../../shared/ui";
import type {
  BrowserActionRecord,
  EmployeeRecord,
  SocialAccountGrantRecord,
  SocialAccountRecord,
  SocialAuditRecord,
} from "../../../../shared/domain";
import { formatRelative } from "../types";

interface ActivityEntry {
  id: string;
  accountId: string | null;
  label: string;
  policyDecision: string;
  actorId: string | null;
  actorType: string;
  createdAt: string;
}

export function SocialActivity({
  accounts,
  grants,
  auditRecords,
  browserActions,
  employees,
}: {
  accounts: SocialAccountRecord[];
  grants: SocialAccountGrantRecord[];
  auditRecords: SocialAuditRecord[];
  browserActions: BrowserActionRecord[];
  employees: EmployeeRecord[];
}) {
  const accountHandle = (id: string | null): string => {
    if (!id) return "—";
    const account = accounts.find((item) => item.id === id);
    return account ? account.handle : "—";
  };
  const employeeName = (id: string | null): string => {
    if (!id) return "System";
    return employees.find((item) => item.id === id)?.displayName ?? id;
  };

  const entries: ActivityEntry[] = [
    ...auditRecords.map((record) => ({
      id: record.id,
      accountId: record.socialAccountId,
      label: humanize(record.eventType),
      policyDecision: record.policyDecision,
      actorId: record.actorId,
      actorType: record.actorType,
      createdAt: record.createdAt,
    })),
    ...browserActions.map((action) => ({
      id: action.id,
      accountId: action.socialAccountId,
      label: humanize(action.actionType),
      policyDecision: action.policyDecision,
      actorId: null,
      actorType: "agent",
      createdAt: action.createdAt,
    })),
  ]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12);

  if (grants.length === 0 && entries.length === 0) return null;

  return (
    <div style={{ marginTop: 28 }}>
      <div className="section-label" style={{ marginBottom: 10 }}>Access &amp; activity</div>
      {grants.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 12 }}>
          {grants.map((grant, index) => (
            <div
              key={grant.id}
              className="row"
              style={{ gap: 10, padding: "10px 16px", borderBottom: index === grants.length - 1 ? "none" : "1px solid var(--border-soft)" }}
            >
              <span style={{ fontWeight: 500, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {employeeName(grant.employeeId)}
              </span>
              <span style={{ color: "var(--text-3)", fontSize: 12 }}>{accountHandle(grant.socialAccountId)}</span>
              <Pill tone="violet">{humanize(grant.role)}</Pill>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)" }}>{scopeSummary(grant.scopeJson)}</span>
            </div>
          ))}
        </div>
      )}
      {entries.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {entries.map((entry, index) => (
            <div
              key={entry.id}
              className="row"
              style={{ gap: 10, padding: "10px 16px", borderBottom: index === entries.length - 1 ? "none" : "1px solid var(--border-soft)" }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>{entry.label}</span>
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>{accountHandle(entry.accountId)}</span>
              <Pill tone={policyTone(entry.policyDecision)}>{humanize(entry.policyDecision)}</Pill>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-3)" }}>
                {entry.actorType === "agent" ? "agent" : employeeName(entry.actorId)} · {formatRelative(entry.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function humanize(value: string): string {
  if (!value) return value;
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function policyTone(decision: string): "green" | "amber" | "red" | undefined {
  if (decision.includes("denied") || decision.includes("blocked")) return "red";
  if (decision.includes("approval")) return "amber";
  if (decision.includes("allowed")) return "green";
  return undefined;
}

function scopeSummary(scopeJson: string): string {
  try {
    const parsed: unknown = JSON.parse(scopeJson);
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { actions?: unknown }).actions)) {
      const actions = (parsed as { actions: unknown[] }).actions.filter((item): item is string => typeof item === "string");
      const ceiling = (parsed as { riskCeiling?: unknown }).riskCeiling;
      const risk = typeof ceiling === "string" ? ` · ≤${ceiling}` : "";
      return `${actions.length} action${actions.length === 1 ? "" : "s"}${risk}`;
    }
  } catch {
    return "scoped";
  }
  return "scoped";
}
