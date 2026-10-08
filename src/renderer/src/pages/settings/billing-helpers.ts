import type { AgentRecord, ProviderRequestRecord } from "../../../../shared/domain";

export interface AgentSpendRow {
  agent: AgentRecord;
  requestCount: number;
  tokens: number;
  spentCents: number;
}

/** Each call counts once, for the agent that made it, whatever provider the agent uses now. */
export function buildAgentSpend(agents: AgentRecord[], requests: ProviderRequestRecord[]): AgentSpendRow[] {
  return agents.map((agent) => {
    const agentRequests = requests.filter((r) => r.agentId === agent.id);
    return {
      agent,
      requestCount: agentRequests.length,
      tokens: agentRequests.reduce((s, r) => s + (r.inputTokens ?? 0) + (r.outputTokens ?? 0), 0),
      spentCents: agentRequests.reduce((s, r) => s + (r.costCents ?? 0), 0),
    };
  }).sort((a, b) => b.spentCents - a.spentCents || b.requestCount - a.requestCount);
}
