import { Target } from "../ui/icons";
import type { CompanyMetrics, SectionId } from "@shared/types";
import { formatDuration, formatMoney, getAgentInitials } from "../../lib/formatters";
import { useT } from "../../i18n";
import { CompactMetric, RunProgressBar } from "./inbox-helpers";
import { Card, Eyebrow } from "../ui";

interface PerformanceProps {
  metrics: CompanyMetrics | null;
  onNavigate: (section: SectionId, entityId?: string) => void;
}

export function PerformanceView({ metrics, onNavigate }: PerformanceProps) {
  const t = useT();
  if (!metrics) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
        <Target size={32} className="mb-3 text-muted-foreground" />
        <div className="text-[14px] font-medium text-muted-foreground">{t("perf.noMetrics")}</div>
        <div className="mt-1 text-[12px] text-muted-foreground">{t("perf.noMetricsDesc")}</div>
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

      <Card padding="lg">
        <Eyebrow className="mb-3">{t("perf.runActivity30d")}</Eyebrow>
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
              <span className="h-2.5 w-2.5 rounded-full bg-success" />
              <span className="text-muted-foreground">{t("perf.runsSucceeded").replace("{n}", String(metrics.successfulRuns))}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-destructive" />
              <span className="text-muted-foreground">{t("perf.runsFailed").replace("{n}", String(metrics.failedRuns))}</span>
            </span>
          </div>
        </div>
      </Card>

      <section>
        <Eyebrow className="mb-3">{t("perf.agentPerformance")}</Eyebrow>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border bg-muted">
                <th className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{t("perf.agent")}</th>
                <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground text-right">{t("perf.tasksDoneCol")}</th>
                <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground text-right">{t("perf.successPct")}</th>
                <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground text-right">{t("perf.runsCol")}</th>
                <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground text-right">{t("perf.avgDuration")}</th>
                <th className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground text-right">{t("perf.costCol")}</th>
              </tr>
            </thead>
            <tbody>
              {metrics.agentMetrics
                .sort((a, b) => b.tasksCompleted - a.tasksCompleted)
                .map((am) => (
                  <tr
                    key={am.agentId}
                    className="border-b border-border bg-card transition hover:bg-muted cursor-pointer"
                    onClick={() => onNavigate("agents", am.agentId)}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                          {getAgentInitials(am.agentName)}
                        </div>
                        <span className="text-[12px] font-medium text-foreground">{am.agentName}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right text-[12px] font-semibold text-success">{am.tasksCompleted}</td>
                    <td className="px-3 py-2.5 text-right">
                      <span className={`text-[12px] font-semibold ${
                        am.successRate >= 80 ? "text-success"
                        : am.successRate >= 50 ? "text-warning"
                        : "text-destructive"
                      }`}>
                        {am.successRate}%
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-[12px] text-muted-foreground">{am.runsTotal}</td>
                    <td className="px-3 py-2.5 text-right text-[12px] text-muted-foreground">{formatDuration(am.avgRunDurationSec)}</td>
                    <td className="px-3 py-2.5 text-right text-[12px] text-muted-foreground">{formatMoney(am.totalCostUsd)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
