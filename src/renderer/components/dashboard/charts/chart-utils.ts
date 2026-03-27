import type { RunRecord, CostRecord, AgentRecord } from "@shared/types";

export interface DailyRunData {
  date: string;       // "YYYY-MM-DD"
  total: number;
  succeeded: number;
  failed: number;
}

export interface DailyCostData {
  date: string;       // "YYYY-MM-DD"
  total: number;      // USD amount (NOT cents)
}

export interface AgentWorkloadData {
  name: string;       // agent name, truncated to 10 chars
  runs: number;
}

/**
 * Aggregate runs into daily buckets for chart consumption.
 * Returns `days` entries sorted ascending by date (oldest first).
 * Days with no runs have {total:0, succeeded:0, failed:0}.
 */
export function aggregateRunsByDay(runs: RunRecord[], days: number): DailyRunData[] {
  const now = new Date();
  const buckets = new Map<string, { total: number; succeeded: number; failed: number }>();

  // Initialize all day buckets with zero values
  for (let i = 0; i < days; i++) {
    const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = date.toISOString().slice(0, 10);
    buckets.set(key, { total: 0, succeeded: 0, failed: 0 });
  }

  // Fill buckets from actual data
  for (const run of runs) {
    const day = run.createdAt.slice(0, 10);
    const bucket = buckets.get(day);
    if (!bucket) continue;
    bucket.total++;
    if (run.status === "succeeded") bucket.succeeded++;
    if (run.status === "failed" || run.status === "timed_out" || run.status === "interrupted") {
      bucket.failed++;
    }
  }

  // Return sorted ascending by date
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({ date, ...data }));
}

/**
 * Aggregate costs into daily buckets for chart consumption.
 * Returns `days` entries sorted ascending by date.
 * Days with no costs have {total:0}. Null amountUsd is treated as 0.
 */
export function aggregateCostsByDay(costs: CostRecord[], days: number): DailyCostData[] {
  const now = new Date();
  const buckets = new Map<string, number>();

  // Initialize all day buckets with zero
  for (let i = 0; i < days; i++) {
    const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = date.toISOString().slice(0, 10);
    buckets.set(key, 0);
  }

  // Sum costs per day
  for (const cost of costs) {
    const day = cost.createdAt.slice(0, 10);
    const current = buckets.get(day);
    if (current === undefined) continue;
    buckets.set(day, current + (cost.amountUsd ?? 0));
  }

  // Return sorted ascending by date
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({ date, total }));
}

/**
 * Group runs by agent and return workload data sorted by run count descending.
 * If more than maxAgents, keep top maxAgents and aggregate rest into "Others".
 * Agent names longer than 10 chars are truncated with ellipsis.
 */
export function aggregateAgentWorkload(
  runs: RunRecord[],
  agents: AgentRecord[],
  maxAgents: number = 8,
): AgentWorkloadData[] {
  // Build name lookup from agents array
  const nameMap = new Map<string, string>();
  for (const agent of agents) {
    nameMap.set(agent.id, agent.name);
  }

  // Count runs per agent
  const counts = new Map<string, number>();
  for (const run of runs) {
    counts.set(run.agentId, (counts.get(run.agentId) ?? 0) + 1);
  }

  // Sort by count descending
  const sorted = Array.from(counts.entries())
    .sort(([, a], [, b]) => b - a);

  const truncateName = (name: string): string =>
    name.length > 10 ? name.slice(0, 10) + "..." : name;

  // If within limit, return all
  if (sorted.length <= maxAgents) {
    return sorted.map(([agentId, runCount]) => ({
      name: truncateName(nameMap.get(agentId) ?? agentId),
      runs: runCount,
    }));
  }

  // Split into top agents and "Others"
  const top = sorted.slice(0, maxAgents);
  const rest = sorted.slice(maxAgents);
  const othersRuns = rest.reduce((sum, [, count]) => sum + count, 0);

  const result: AgentWorkloadData[] = top.map(([agentId, runCount]) => ({
    name: truncateName(nameMap.get(agentId) ?? agentId),
    runs: runCount,
  }));

  result.push({ name: "Others", runs: othersRuns });
  return result;
}

/**
 * Format a YYYY-MM-DD date string as "MMM dd" (e.g., "Mar 15").
 * Uses T00:00:00 suffix to avoid timezone shift.
 */
export function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
