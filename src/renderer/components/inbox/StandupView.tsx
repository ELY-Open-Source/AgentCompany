import {
  ArrowRight,
  CheckCircle,
  Clock,
  Heartbeat,
  Warning,
} from "@phosphor-icons/react";
import type { SectionId, StandupReport } from "@shared/types";
import { getAgentInitials } from "../../lib/formatters";
import { useT } from "../../i18n";

interface StandupProps {
  report: StandupReport | null;
  onNavigate: (section: SectionId, entityId?: string) => void;
}

export function StandupView({ report, onNavigate }: StandupProps) {
  const t = useT();
  if (!report) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[8px] border border-dashed border-[color:var(--line)] py-16 text-center">
        <Clock size={32} className="mb-3 text-[color:var(--muted)]" />
        <div className="text-[14px] font-medium text-[color:var(--muted-strong)]">{t("standup.noData")}</div>
        <div className="mt-1 text-[12px] text-[color:var(--muted)]">{t("standup.noDataDesc")}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-[color:var(--accent-soft)]">
            <Heartbeat size={20} weight="fill" className="text-[color:var(--accent)]" />
          </div>
          <div>
            <h2 className="text-[16px] font-bold text-[color:var(--text)]">{t("standup.dailyStandup")}</h2>
            <p className="text-[12px] text-[color:var(--muted)]">
              Generated {new Date(report.generatedAt).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="text-[14px] font-medium text-[color:var(--text)]">{report.summary}</div>
        <div className="mt-3 flex gap-4">
          <div className="text-center">
            <div className="text-[18px] font-bold tabular-nums text-[color:var(--success)]">{report.agentReports.filter(r => r.tasksCompleted24h > 0).length}</div>
            <div className="text-[10px] text-[color:var(--muted)]">{t("standup.productive")}</div>
          </div>
          <div className="h-10 w-px bg-[color:var(--line)]" />
          <div className="text-center">
            <div className="text-[18px] font-bold tabular-nums text-[color:var(--danger)]">{report.blockers.length}</div>
            <div className="text-[10px] text-[color:var(--muted)]">{t("standup.blockers")}</div>
          </div>
          <div className="h-10 w-px bg-[color:var(--line)]" />
          <div className="text-center">
            <div className="text-[18px] font-bold tabular-nums text-[color:var(--warn)]">{report.pendingApprovals}</div>
            <div className="text-[10px] text-[color:var(--muted)]">{t("standup.pendingApprovals")}</div>
          </div>
          <div className="h-10 w-px bg-[color:var(--line)]" />
          <div className="text-center">
            <div className={`text-[18px] font-bold tabular-nums ${report.budgetUtilization > 80 ? "text-[color:var(--danger)]" : "text-[color:var(--text)]"}`}>
              {report.budgetUtilization}%
            </div>
            <div className="text-[10px] text-[color:var(--muted)]">{t("standup.budgetUsed")}</div>
          </div>
        </div>
      </div>

      {report.companyHighlights.length > 0 ? (
        <section>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("standup.highlights")}</div>
          <div className="space-y-1.5">
            {report.companyHighlights.map((h, i) => (
              <div key={i} className="flex items-center gap-2 rounded-[6px] bg-[color:var(--success-soft)] px-3 py-2 text-[12px] text-[color:var(--success)]">
                <CheckCircle size={14} weight="fill" />
                {h}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {report.blockers.length > 0 ? (
        <section>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--danger)]">Blockers</div>
          <div className="space-y-1.5">
            {report.blockers.map((b, i) => (
              <div key={i} className="flex items-center gap-2 rounded-[6px] bg-[color:var(--danger-soft)] px-3 py-2 text-[12px] text-[color:var(--danger)]">
                <Warning size={14} weight="fill" />
                {b}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">{t("standup.agentStatus")}</div>
        <div className="space-y-2">
          {report.agentReports.map((ar) => (
            <button
              key={ar.agentId}
              type="button"
              onClick={() => onNavigate("agents", ar.agentId)}
              className="flex w-full items-center gap-3 rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3 text-left transition hover:border-[color:var(--line-strong)] hover:shadow-sm"
            >
              <div className="relative">
                <div className={`flex h-10 w-10 items-center justify-center rounded-full text-[12px] font-bold ${
                  ar.status === "running" ? "bg-[color:var(--success-soft)] text-[color:var(--success)]"
                  : ar.status === "error" ? "bg-[color:var(--danger-soft)] text-[color:var(--danger)]"
                  : "bg-[color:var(--panel-soft)] text-[color:var(--muted-strong)]"
                }`}>
                  {getAgentInitials(ar.agentName)}
                </div>
                {ar.status === "running" ? (
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[color:var(--success)] opacity-40" style={{ willChange: "transform" }} />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[color:var(--success)]" />
                  </span>
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-[color:var(--text)]">{ar.agentName}</span>
                  <span className="text-[10px] text-[color:var(--muted)]">{ar.role}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-[color:var(--muted)]">
                  {ar.tasksInProgress > 0 ? <span className="text-[color:var(--accent)]">{ar.tasksInProgress} in progress</span> : null}
                  {ar.tasksCompleted24h > 0 ? <span className="text-[color:var(--success)]">{ar.tasksCompleted24h} done</span> : null}
                  {ar.tasksBlocked > 0 ? <span className="text-[color:var(--danger)]">{ar.tasksBlocked} blocked</span> : null}
                  {ar.costLast24h > 0 ? <span className="tabular-nums">${ar.costLast24h.toFixed(2)}</span> : null}
                </div>
                {ar.highlights.length > 0 ? (
                  <div className="mt-1 text-[10px] text-[color:var(--muted)]">{ar.highlights.join(" \u00B7 ")}</div>
                ) : null}
              </div>
              <ArrowRight size={14} className="shrink-0 text-[color:var(--muted)]" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
