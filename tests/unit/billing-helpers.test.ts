import { describe, expect, test } from "vitest";
import { buildAgentSpend } from "../../src/renderer/src/pages/settings/billing-helpers";
import type { AgentRecord, ProviderRequestRecord } from "../../src/shared/domain";

const agent = (id: string, modelProviderId: string) => ({ id, name: id, modelProviderId, budgetCents: 1000 }) as AgentRecord;
const call = (agentId: string | null, providerId: string, costCents: number | null) =>
  ({ agentId, providerId, inputTokens: 100, outputTokens: 50, costCents }) as ProviderRequestRecord;

describe("billing attribution", () => {
  test("each call counts once for the agent that made it, not for everyone on the same provider", () => {
    const rows = buildAgentSpend([agent("ada", "prv_a"), agent("bo", "prv_a"), agent("cy", "prv_b")], [
      call("ada", "prv_a", 10), call("ada", "prv_a", 5), call("bo", "prv_a", 1), call("cy", "prv_a", 2), call(null, "prv_a", 99),
    ]);
    expect(rows.map((row) => [row.agent.id, row.requestCount, row.tokens, row.spentCents])).toEqual([
      ["ada", 2, 300, 15], ["cy", 1, 150, 2], ["bo", 1, 150, 1],
    ]);
  });
});
