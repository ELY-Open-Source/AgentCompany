import { TASK_STATUS, type AgentRecord, type TaskRecord } from "../../../../shared/domain";
import { t } from "../../i18n/i18n";

/** Open work per agent for the chart: the busiest get their own bar, the rest share one labelled bar, and the total counts everyone. */
export function workloadBars(agents: AgentRecord[], tasks: TaskRecord[], maxBars: number): { bars: Array<{ key: string; label: string; count: number }>; total: number } {
  const counts = agents.map((agent) => ({
    key: agent.id,
    label: agent.name.split(/\s+/)[0] ?? agent.name,
    count: tasks.filter((task) => task.assigneeAgentId === agent.id && task.status !== TASK_STATUS.DONE).length,
  }));
  const total = counts.reduce((sum, item) => sum + item.count, 0);
  if (counts.length <= maxBars) return { bars: counts, total };
  const ranked = [...counts].sort((a, b) => b.count - a.count);
  const shown = ranked.slice(0, maxBars - 1);
  const rest = ranked.slice(maxBars - 1);
  const others = { key: "others", label: t("{n} others", { n: rest.length }), count: rest.reduce((sum, item) => sum + item.count, 0) };
  return { bars: [...shown, others], total };
}
