import { describe, expect, it } from "vitest";
import type { AgentMessageRecord, AgentRecord } from "../../src/shared/types";
import { deriveChannels, getChannelMessages } from "../../src/renderer/components/communication/channel-utils";

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
    toAgentId: input.toAgentId ?? "agent-cto",
    senderKind: input.senderKind ?? "agent",
    channel: input.channel ?? "direct",
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

describe("communication channel utilities", () => {
  it("drops legacy direct messages whose sender and recipient are the same agent", () => {
    const ceo = agent("agent-ceo", "CEO");
    const selfMessage = message({
      id: "self-direct",
      fromAgentId: ceo.id,
      toAgentId: ceo.id,
    });

    const channels = deriveChannels([selfMessage], [ceo]);

    expect(channels.map((channel) => channel.label)).not.toContain("CEO ↔ CEO");
    expect(channels.some((channel) => channel.kind === "message" && channel.channel === "direct")).toBe(false);
  });

  it("keeps normal direct conversations visible", () => {
    const ceo = agent("agent-ceo", "CEO");
    const cto = agent("agent-cto", "CTO");
    const direct = message({
      id: "ceo-cto",
      fromAgentId: ceo.id,
      toAgentId: cto.id,
    });

    const channels = deriveChannels([direct], [ceo, cto]);
    const dm = channels.find((channel) => channel.kind === "message" && channel.channel === "direct");

    expect(dm?.label).toBe("CEO ↔ CTO");
    expect(dm ? getChannelMessages([direct], dm).map((entry) => entry.id) : []).toEqual(["ceo-cto"]);
  });
});
