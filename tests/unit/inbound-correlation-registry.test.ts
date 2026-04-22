import { describe, expect, it } from "vitest";
import { InboundCorrelationRegistryStore } from "../../src/main/agent-runtime/inbound-correlation-registry";
import type { AgentMessageRecord } from "../../src/shared/types";

function makeMessage(index: number): AgentMessageRecord {
  return {
    id: `message-${index}`,
    companyId: "company-1",
    fromAgentId: `agent-${index}`,
    toAgentId: "agent-recipient",
    senderKind: "agent",
    channel: "direct",
    channelTargetId: null,
    subject: `message ${index}`,
    body: `body ${index}`,
    priority: "normal",
    readAt: null,
    parentMessageId: null,
    attachmentsJson: "[]",
    createdAt: "2026-04-22T00:00:00.000Z",
  };
}

describe("InboundCorrelationRegistryStore", () => {
  it("preserves every inbound correlation for the active run", () => {
    const store = new InboundCorrelationRegistryStore();
    const timestamps: number[] = [];

    for (let i = 0; i < 700; i += 1) {
      timestamps.push(store.register("run-1", makeMessage(i), 1_000));
    }

    expect(new Set(timestamps).size).toBe(700);
    for (let i = 0; i < timestamps.length; i += 1) {
      expect(store.lookup("run-1", timestamps[i])).toMatchObject({
        fromAgentId: `agent-${i}`,
        messageId: `message-${i}`,
      });
    }
  });

  it("drops correlations only when the run is released", () => {
    const store = new InboundCorrelationRegistryStore();
    const timestamp = store.register("run-1", makeMessage(1), 1_000);

    expect(store.lookup("run-1", timestamp)?.messageId).toBe("message-1");
    store.deleteRun("run-1");
    expect(store.lookup("run-1", timestamp)).toBeNull();
  });
});
