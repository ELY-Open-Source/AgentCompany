import { Target } from "@phosphor-icons/react";
import type { CompanyMetrics, SectionId } from "@shared/types";
import { formatDuration, formatMoney, getAgentInitials } from "../../lib/formatters";
import { useT } from "../../i18n";
import { CompactMetric, RunProgressBar } from "./inbox-helpers";

interface PerformanceProps {
  metrics: CompanyMetrics | null;
  onNavigate: (section: SectionId, entityId?: string) => void;
}

export function PerformanceView({ metrics, onNavigate }: PerformanceProps) {
  const t = useT();
  if (!metrics) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[8px] border border-dashed border-[color:var(--line)] py-16 text-center">
        <Target size={32} className="mb-3 text-[color:var(--muted)]" />
        <div className="text-[14px] font-medium text-[color:var(--muted-strong)]">{t("perf.noMetrics")}</div>
        <div className="mt-1 text-[12px] text-[color:var(--muted)]">{t("perf.noMetricsDesc")}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <CompactMetric
          label={t("perf.successRate")}
          value={`${metrics.overallSuccessRate}%`}
          tone={metrics.overallSuccessRate >= 80 ? "success" : metrics.overallSuccessRate >= 50 ? "warn" : "danger"}
        />
        <CompactMetric
          label={t("perf.tasksDone")}
          value={metrics.completedTasks}
          tone="success"
          subtitle={`of ${metrics.totalTasks} total`}
        />
        <CompactMetric
          label={t("perf.throughput")}
          value={`${metrics.throughputTasksPerDay.toFixed(1)}`}
          tone="accent"
          subtitle={t("perf.tasksPerDay")}
        />
        <CompactMetric
          label={t("perf.avgCostTask")}
          value={formatMoney(metrics.avgCostPerTask)}
          tone="default"
        />
      </div>

      <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] p-5">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Run Activity (30d)</div>
        <div className="flex items-center gap-6">
          <div className="flex-1">
            <RunProgressBar
              succeeded={metrics.successfulRuns}
              failed={metrics.failedRuns}
              total={metrics.totalRuns}
            />
          </div>
          <div className="flex gap-4 text-[12px]">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--success)]" />
              <span className="text-[color:var(--muted)]">{metrics.successfulRuns} succeeded</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[color:var(--danger)]" />
              <span className="text-[color:var(--muted)]">{metrics.failedRuns} failed</span>
            </span>
          </div>
        </div>
      </div>

      <section>
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Agent Performance</div>
        <div className="overflow-x-auto rounded-[8px] border border-[color:var(--line)]">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[color:var(--line)] bg-[color:var(--panel-soft)]">
                <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)]">Agent</th>
                <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)] text-right">Tasks Done</th>
                <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)] text-right">Success %</th>
                <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)] text-right">Runs</th>
                <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)] text-right">Avg Duration</th>
                <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted)] text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {metrics.agentMetrics
                .sort((a, b) => b.tasksCompleted - a.tasksCompleted)
                .map((am) => (
                  <tr
                    key={am.agentId}
                    className="border-b border-[color:var(--line)] bg-[color:var(--panel)] transition hover:bg-[color:var(--panel-soft)] cursor-pointer"
                    onClick={() => onNavigate("agents", am.agentId)}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[color:var(--panel-soft)] text-[10px] font-bold text-[color:var(--muted-strong)]">
                          {getAgentInitials(am.agentName)}
                        </div>
                        <span className="text-[12px] font-medium text-[color:var(--text)]">{am.agentName}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-[12px] font-semibold text-[color:var(--success)]">{am.tasksCompleted}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={`text-[12px] font-semibold ${
                        am.successRate >= 80 ? "text-[color:var(--success)]"
                        : am.successRate >= 50 ? "text-[color:var(--warn)]"
                        : "text-[color:var(--danger)]"
                      }`}>
                        {am.successRate}%
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-[12px] text-[color:var(--muted)]">{am.runsTotal}</td>
                    <td className="px-3 py-2.5 text-right text-[12px] text-[color:var(--muted)]">{formatDuration(am.avgRunDurationSec)}</td>
                    <td className="px-3 py-2.5 text-right text-[12px] text-[color:var(--muted)]">{formatMoney(am.totalCostUsd)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
