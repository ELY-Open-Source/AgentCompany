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
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
        <Clock size={32} className="mb-3 text-muted-foreground" />
        <div className="text-[14px] font-medium text-muted-foreground">{t("standup.noData")}</div>
        <div className="mt-1 text-[12px] text-muted-foreground">{t("standup.noDataDesc")}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
            <Heartbeat size={20} weight="fill" className="text-primary" />
          </div>
          <div>
            <h2 className="text-[16px] font-bold text-foreground">{t("standup.dailyStandup")}</h2>
            <p className="text-[12px] text-muted-foreground">
              Generated {new Date(report.generatedAt).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="text-[14px] font-medium text-foreground">{report.summary}</div>
        <div className="mt-3 flex gap-4">
          <div className="text-center">
            <div className="text-[18px] font-bold tabular-nums text-green-600 dark:text-green-400">{report.agentReports.filter(r => r.tasksCompleted24h > 0).length}</div>
            <div className="text-[10px] text-muted-foreground">{t("standup.productive")}</div>
          </div>
          <div className="h-10 w-px bg-[color:var(--border)]" />
          <div className="text-center">
            <div className="text-[18px] font-bold tabular-nums text-destructive">{report.blockers.length}</div>
            <div className="text-[10px] text-muted-foreground">{t("standup.blockers")}</div>
          </div>
          <div className="h-10 w-px bg-[color:var(--border)]" />
          <div className="text-center">
            <div className="text-[18px] font-bold tabular-nums text-yellow-600 dark:text-yellow-400">{report.pendingApprovals}</div>
            <div className="text-[10px] text-muted-foreground">{t("standup.pendingApprovals")}</div>
          </div>
          <div className="h-10 w-px bg-[color:var(--border)]" />
          <div className="text-center">
            <div className={`text-[18px] font-bold tabular-nums ${report.budgetUtilization > 80 ? "text-destructive" : "text-foreground"}`}>
              {report.budgetUtilization}%
            </div>
            <div className="text-[10px] text-muted-foreground">{t("standup.budgetUsed")}</div>
          </div>
        </div>
      </div>

      {report.companyHighlights.length > 0 ? (
        <section>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("standup.highlights")}</div>
          <div className="space-y-1.5">
            {report.companyHighlights.map((h, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-green-100 dark:bg-green-900/50 px-3 py-2 text-[12px] text-green-600 dark:text-green-400">
                <CheckCircle size={14} weight="fill" />
                {h}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {report.blockers.length > 0 ? (
        <section>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-destructive">Blockers</div>
          <div className="space-y-1.5">
            {report.blockers.map((b, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-red-100 dark:bg-red-900/50 px-3 py-2 text-[12px] text-destructive">
                <Warning size={14} weight="fill" />
                {b}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("standup.agentStatus")}</div>
        <div className="space-y-2">
          {report.agentReports.map((ar) => (
            <button
              key={ar.agentId}
              type="button"
              onClick={() => onNavigate("agents", ar.agentId)}
              className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition hover:border-border hover:shadow-sm"
            >
              <div className="relative">
                <div className={`flex h-10 w-10 items-center justify-center rounded-full text-[12px] font-bold ${
                  ar.status === "running" ? "bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400"
                  : ar.status === "error" ? "bg-red-100 dark:bg-red-900/50 text-destructive"
                  : "bg-muted text-muted-foreground"
                }`}>
                  {getAgentInitials(ar.agentName)}
                </div>
                {ar.status === "running" ? (
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-600 dark:bg-green-400 opacity-40" style={{ willChange: "transform" }} />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-green-600 dark:bg-green-400" />
                  </span>
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-foreground">{ar.agentName}</span>
                  <span className="text-[10px] text-muted-foreground">{ar.role}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                  {ar.tasksInProgress > 0 ? <span className="text-primary">{ar.tasksInProgress} in progress</span> : null}
                  {ar.tasksCompleted24h > 0 ? <span className="text-green-600 dark:text-green-400">{ar.tasksCompleted24h} done</span> : null}
                  {ar.tasksBlocked > 0 ? <span className="text-destructive">{ar.tasksBlocked} blocked</span> : null}
                  {ar.costLast24h > 0 ? <span className="tabular-nums">${ar.costLast24h.toFixed(2)}</span> : null}
                </div>
                {ar.highlights.length > 0 ? (
                  <div className="mt-1 text-[10px] text-muted-foreground">{ar.highlights.join(" \u00B7 ")}</div>
                ) : null}
              </div>
              <ArrowRight size={14} className="shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
