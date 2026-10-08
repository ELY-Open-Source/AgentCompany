import type { DatabaseSync } from "node:sqlite";
import type { UsageStatsRecord } from "../../shared/usage-stats";

const WEEK_DAYS = 7;
const MONTH_DAYS = 30;

/** Period statistics per org, computed over every record in the period, not over the snapshot's recent lists. */
export function buildUsageStats(db: DatabaseSync, now: Date): UsageStatsRecord[] {
  const orgs = db.prepare("select id from organizations").all() as Array<{ id: string }>;
  const dayStarts = Array.from({ length: WEEK_DAYS }, (_, index) => localDayStart(now, WEEK_DAYS - 1 - index));
  const weekStart = dayStarts[0].toISOString();
  // "Last 30 days" is a rolling window ending now.
  const monthStart = new Date(now.getTime() - MONTH_DAYS * 86_400_000).toISOString();
  return orgs.map(({ id: orgId }) => {
    const runs = db.prepare("select created_at, state from task_runs where org_id = ? and created_at >= ?").all(orgId, weekStart) as Array<{ created_at: string; state: string }>;
    const calls = db.prepare(`
      select created_at, state, input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, cost_cents, agent_id, provider_id
      from provider_requests where org_id = ? and created_at >= ?
    `).all(orgId, monthStart) as Array<{
      created_at: string; state: string; input_tokens: number | null; output_tokens: number | null;
      cached_input_tokens: number | null; reasoning_tokens: number | null; cost_cents: number | null; agent_id: string | null; provider_id: string;
    }>;
    const days = dayStarts.map((start, index) => {
      const end = index + 1 < dayStarts.length ? dayStarts[index + 1] : localDayStart(now, -1);
      const inDay = (iso: string) => { const at = Date.parse(iso); return at >= start.getTime() && at < end.getTime(); };
      const dayRuns = runs.filter((run) => inDay(run.created_at));
      const dayCalls = calls.filter((call) => inDay(call.created_at));
      return {
        dayStart: start.toISOString(),
        runs: dayRuns.length,
        completedRuns: dayRuns.filter((run) => run.state === "completed").length,
        failedRuns: dayRuns.filter((run) => run.state === "failed").length,
        tokens: dayCalls.reduce((sum, call) => sum + (call.input_tokens ?? 0) + (call.output_tokens ?? 0), 0),
        callsWithoutUsage: dayCalls.filter((call) => call.input_tokens === null).length,
      };
    });
    const agentSpend = new Map<string, { requests: number; tokens: number; costCents: number }>();
    for (const call of calls) {
      if (!call.agent_id) continue;
      const entry = agentSpend.get(call.agent_id) ?? { requests: 0, tokens: 0, costCents: 0 };
      entry.requests += 1;
      entry.tokens += (call.input_tokens ?? 0) + (call.output_tokens ?? 0);
      entry.costCents += call.cost_cents ?? 0;
      agentSpend.set(call.agent_id, entry);
    }
    const providerActivity = new Map<string, { requests: number; failures: number }>();
    for (const call of calls) {
      const entry = providerActivity.get(call.provider_id) ?? { requests: 0, failures: 0 };
      entry.requests += 1;
      if (call.state === "failed") entry.failures += 1;
      providerActivity.set(call.provider_id, entry);
    }
    const sum = (pick: (call: typeof calls[number]) => number | null) => calls.reduce((total, call) => total + (pick(call) ?? 0), 0);
    return {
      orgId,
      days,
      month: {
        requests: calls.length,
        failures: calls.filter((call) => call.state === "failed").length,
        inputTokens: sum((call) => call.input_tokens),
        cachedInputTokens: sum((call) => call.cached_input_tokens),
        outputTokens: sum((call) => call.output_tokens),
        reasoningTokens: sum((call) => call.reasoning_tokens),
        callsWithoutUsage: calls.filter((call) => call.input_tokens === null).length,
      },
      agentSpend: [...agentSpend].map(([agentId, entry]) => ({ agentId, ...entry })),
      providerActivity: [...providerActivity].map(([providerId, entry]) => ({ providerId, ...entry })),
    };
  });
}

/** Local midnight of the calendar day `daysAgo` days before today; calendar arithmetic keeps DST days 23 or 25 hours long. */
function localDayStart(now: Date, daysAgo: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
}
