import { useMemo } from "react";
import { motion } from "framer-motion";
import type { RunRecord, CostRecord, AgentRecord } from "@shared/types";
import { Eyebrow, useReducedMotion } from "../ui";
import { useT } from "../../i18n";
import {
  aggregateRunsByDay,
  aggregateCostsByDay,
  aggregateAgentWorkload,
} from "./charts/chart-utils";
import { ChartCard } from "./charts/ChartCard";
import { RunActivityChart } from "./charts/RunActivityChart";
import { SuccessRateChart } from "./charts/SuccessRateChart";
import { CostTrendChart } from "./charts/CostTrendChart";
import { AgentWorkloadChart } from "./charts/AgentWorkloadChart";
import { BudgetUtilization } from "./charts/BudgetUtilization";

interface ChartSectionProps {
  runs: RunRecord[];
  costs: CostRecord[];
  agents: AgentRecord[];
  companyId: string;
}

export function ChartSection({ runs, costs, agents, companyId }: ChartSectionProps) {
  const t = useT();
  const reducedMotion = useReducedMotion();

  const dailyRuns = useMemo(() => aggregateRunsByDay(runs, 14), [runs]);
  const dailyCosts = useMemo(() => aggregateCostsByDay(costs, 14), [costs]);
  const agentWorkload = useMemo(
    () => aggregateAgentWorkload(runs, agents),
    [runs, agents],
  );

  const hasRunData = dailyRuns.some((d) => d.total > 0);
  const hasCostData = dailyCosts.some((d) => d.total > 0);

  const totalRuns = dailyRuns.reduce((s, d) => s + d.total, 0);

  const content = (
    <div className="space-y-6">
      {/* Section header */}
      <Eyebrow>{t("chart.performance")}</Eyebrow>

      {/* 2-column chart grid */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <ChartCard
          title={t("chart.runActivity")}
          ariaLabel={t("chart.runActivityAria").replace("{count}", String(totalRuns))}
          isEmpty={!hasRunData}
        >
          <RunActivityChart data={dailyRuns} reducedMotion={reducedMotion} />
        </ChartCard>
        <ChartCard
          title={t("chart.successRate")}
          ariaLabel={t("chart.successRateAria")}
          isEmpty={!hasRunData}
        >
          <SuccessRateChart data={dailyRuns} reducedMotion={reducedMotion} />
        </ChartCard>
        <ChartCard
          title={t("chart.costTrend")}
          ariaLabel={t("chart.costTrendAria")}
          isEmpty={!hasCostData}
        >
          <CostTrendChart data={dailyCosts} reducedMotion={reducedMotion} />
        </ChartCard>
        <ChartCard
          title={t("chart.agentWorkload")}
          ariaLabel={t("chart.agentWorkloadAria")}
          isEmpty={agentWorkload.length === 0}
        >
          <AgentWorkloadChart data={agentWorkload} reducedMotion={reducedMotion} />
        </ChartCard>
      </div>

      {/* Budget Utilization section */}
      <Eyebrow>{t("chart.budgetUtilization")}</Eyebrow>
      <BudgetUtilization companyId={companyId} agents={agents} />
    </div>
  );

  if (reducedMotion) {
    return content;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      {content}
    </motion.div>
  );
}
