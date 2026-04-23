import { describe, expect, it } from "vitest";
import type { AgentMessageRecord, AgentRecord } from "../../src/shared/types";
import {
  DEFAULT_MESSAGE_FILTERS,
  filterChannelMessages,
  hasActiveMessageFilters,
} from "../../src/renderer/components/communication/message-filters";

function agent(id: string, name: string): AgentRecord {
  return {
    id,
    companyId: "company-1",
    name,
    role: name,
    title: name,
    department: null,
    status: "active",
    reportsTo: null,
    connectorId: "openai-codex",
    workspaceId: null,
    model: null,
    capabilities: "",
    budgetMonthlyUsd: 0,
    spentMonthlyUsd: 0,
    metadataJson: "{}",
    heartbeatEnabled: false,
    heartbeatIntervalSec: 300,
    lastHeartbeatAt: null,
    createdAt: "2026-04-22T00:00:00.000Z",
    updatedAt: "2026-04-22T00:00:00.000Z",
  };
}

function message(input: Partial<AgentMessageRecord>): AgentMessageRecord {
  return {
    id: input.id ?? "msg-1",
    companyId: "company-1",
    fromAgentId: input.fromAgentId ?? "agent-ceo",
    toAgentId: input.toAgentId ?? null,
    senderKind: input.senderKind ?? "agent",
    channel: input.channel ?? "company",
    channelTargetId: input.channelTargetId ?? null,
    subject: input.subject ?? "Subject",
    body: input.body ?? "Body",
    priority: input.priority ?? "normal",
    parentMessageId: input.parentMessageId ?? null,
    attachmentsJson: input.attachmentsJson ?? "[]",
    createdAt: input.createdAt ?? "2026-04-22T00:00:00.000Z",
    readAt: input.readAt ?? null,
  };
}

describe("message filters", () => {
  it("keeps read and unread channel messages in the default channel view", () => {
    const read = message({ id: "read", readAt: "2026-04-22T00:00:01.000Z" });
    const unread = message({ id: "unread", readAt: null });

    const result = filterChannelMessages(
      [read, unread],
      DEFAULT_MESSAGE_FILTERS,
      new Map(),
      "",
    );

    expect(result.map((entry) => entry.id)).toEqual(["read", "unread"]);
  });

  it("filters by text and sender inside the selected channel", () => {
    const ceo = agent("agent-ceo", "Ada CEO");
    const cto = agent("agent-cto", "Grace CTO");
    const messages = [
      message({ id: "ceo", fromAgentId: ceo.id, subject: "Launch", body: "Board update" }),
      message({ id: "cto", fromAgentId: cto.id, subject: "Infra", body: "Runtime ready" }),
    ];

    const result = filterChannelMessages(
      messages,
      { ...DEFAULT_MESSAGE_FILTERS, search: "grace" },
      new Map([
        [ceo.id, ceo],
        [cto.id, cto],
      ]),
      "",
    );

    expect(result.map((entry) => entry.id)).toEqual(["cto"]);
  });

  it("detects active message filters", () => {
    expect(hasActiveMessageFilters(DEFAULT_MESSAGE_FILTERS)).toBe(false);
    expect(hasActiveMessageFilters({ ...DEFAULT_MESSAGE_FILTERS, priority: "urgent" })).toBe(true);
  });
});
