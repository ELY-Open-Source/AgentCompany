/** One org's period statistics: the last 7 local days, and the last 30 days of provider calls. */
export interface UsageStatsRecord {
  orgId: string;
  days: Array<{
    dayStart: string;
    runs: number;
    completedRuns: number;
    failedRuns: number;
    tokens: number;
    callsWithoutUsage: number;
  }>;
  month: {
    requests: number;
    failures: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    callsWithoutUsage: number;
  };
  agentSpend: Array<{ agentId: string; requests: number; tokens: number; costCents: number }>;
  providerActivity: Array<{ providerId: string; requests: number; failures: number }>;
}
