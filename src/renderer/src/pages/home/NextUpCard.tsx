import type { AgentRecord, ApprovalRecord, EmployeeRecord } from "../../../../shared/domain";
import { approvalKindLabel, riskLabel } from "../../i18n/labels";
import { t } from "../../i18n/i18n";
import { Button, Icon, Pill } from "../../shared/ui";
import type { NextUpItem } from "./next-up";

const SHOWN = 3;
const TITLE = { fontSize: "var(--fs-body)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
const META = { fontSize: "var(--fs-body)", color: "var(--text-3)", margin: "2px 0 8px" } as const;

/** Home's one place for what to look at next: decisions and stopped work in priority order, or else the next task in line. */
export function NextUpCard({
  needsYou,
  next,
  agents,
  employees,
  onApprove,
  onOpenApprovals,
  onOpenTask,
}: {
  needsYou: NextUpItem[];
  next: NextUpItem | null;
  agents: AgentRecord[];
  employees: EmployeeRecord[];
  onApprove: (approvalId: string) => void;
  onOpenApprovals: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const more = needsYou.length - SHOWN;
  return (
    <section className="card" aria-label={t("Needs you")}>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className="card-label">{t("Needs you")}</span>
        {needsYou.length > 0 && <span style={{ marginLeft: "auto" }}><Pill tone="amber">{needsYou.length}</Pill></span>}
      </div>
      {needsYou.length === 0 ? (
        <>
          <div className="row" style={{ gap: 8, color: "var(--text-3)", fontSize: "var(--fs-body)", marginBottom: 12 }}>
            <Icon name="check" /><span>{t("You're all caught up")}</span>
          </div>
          {next?.kind === "next" && (
            <div>
              <div className="card-label">{t("Next in line")}</div>
              <div style={TITLE}>{next.task.title}</div>
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <Button size="small" onClick={() => onOpenTask(next.task.id)}>{t("Open")}</Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <ol style={{ display: "flex", flexDirection: "column", gap: 16, listStyle: "none", margin: 0, padding: 0 }}>
          {needsYou.slice(0, SHOWN).map((item) => item.kind === "approval" ? (
            <li key={item.approval.id}>
              <div style={TITLE}>{item.approval.title}</div>
              <div style={META}>
                {t("{kind} · {risk} risk · from {requester}", { kind: approvalKindLabel(item.approval.kind), risk: riskLabel(item.approval.risk), requester: requesterName(item.approval, employees, agents) })}
              </div>
              <div className="row" style={{ gap: 8 }}>
                <Button tone="primary" size="small" onClick={() => onApprove(item.approval.id)}>{t("Approve")}</Button>
                <Button size="small" onClick={onOpenApprovals}>{t("Open")}</Button>
              </div>
            </li>
          ) : item.kind === "held" ? (
            <li key={item.task.id}>
              <div style={TITLE}>{item.task.title}</div>
              <div style={{ ...META, color: "var(--amber)" }}>{t("Stopped: {reason}", { reason: item.reason })}</div>
              <Button size="small" onClick={() => onOpenTask(item.task.id)}>{t("Open")}</Button>
            </li>
          ) : null)}
          {more > 0 && <li style={{ fontSize: "var(--fs-body)", color: "var(--text-3)" }}>{t("{n} more after these", { n: more })}</li>}
        </ol>
      )}
    </section>
  );
}

function requesterName(approval: ApprovalRecord, employees: EmployeeRecord[], agents: AgentRecord[]): string {
  if (approval.requestedByType === "employee" && approval.requestedById) {
    const employee = employees.find((item) => item.id === approval.requestedById);
    if (employee) return employee.displayName;
  }
  if (approval.requestedByType === "agent" && approval.requestedById) {
    const agent = agents.find((item) => item.id === approval.requestedById);
    if (agent) return agent.name;
  }
  return t("System");
}
