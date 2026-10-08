import { describe, expect, test } from "vitest";
import { buildAgentSpend } from "../../src/renderer/src/pages/settings/billing-helpers";
import type { AgentRecord } from "../../src/shared/domain";

const agent = (id: string, modelProviderId: string) => ({ id, name: id, modelProviderId, budgetCents: 1000 }) as AgentRecord;

describe("billing attribution", () => {
  test("rows come from per-agent totals, highest spend first, agents without calls at zero", () => {
    const rows = buildAgentSpend([agent("ada", "prv_a"), agent("bo", "prv_a"), agent("cy", "prv_b")], [
      { agentId: "ada", requests: 2, tokens: 300, costCents: 15 },
      { agentId: "cy", requests: 1, tokens: 150, costCents: 2 },
    ]);
    expect(rows.map((row) => [row.agent.id, row.requestCount, row.tokens, row.spentCents])).toEqual([
      ["ada", 2, 300, 15], ["cy", 1, 150, 2], ["bo", 0, 0, 0],
    ]);
  });
});
