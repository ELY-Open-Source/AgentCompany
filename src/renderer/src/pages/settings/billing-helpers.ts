import type { AgentRecord } from "../../../../shared/domain";
import type { UsageStatsRecord } from "../../../../shared/usage-stats";

export interface AgentSpendRow {
  agent: AgentRecord;
  requestCount: number;
  tokens: number;
  spentCents: number;
}

/** Each call counts once, for the agent that made it, whatever provider the agent uses now. */
export function buildAgentSpend(agents: AgentRecord[], spend: UsageStatsRecord["agentSpend"]): AgentSpendRow[] {
  return agents.map((agent) => {
    const entry = spend.find((row) => row.agentId === agent.id);
    return { agent, requestCount: entry?.requests ?? 0, tokens: entry?.tokens ?? 0, spentCents: entry?.costCents ?? 0 };
  }).sort((a, b) => b.spentCents - a.spentCents || b.requestCount - a.requestCount);
}
