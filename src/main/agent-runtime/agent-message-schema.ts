import type { AgentMessage } from "@mariozechner/pi-agent-core";

const AGENT_MESSAGE_SCHEMA_VERSION = 1;
const ALLOWED_AGENT_MESSAGE_ROLES = new Set(["user", "assistant", "toolResult"]);

interface PersistedAgentMessageEnvelope {
  schemaVersion: 1;
  kind: "agent_message";
  message: AgentMessage;
  persistedAt: string;
}

interface SessionEntryPayloadRow {
  id: string;
  payloadJson: string;
}

function formatMessageError(prefix: string, message: string): Error {
  return new Error(`${prefix}: ${message}`);
}

function assertRecord(value: unknown, prefix: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw formatMessageError(prefix, "expected an object");
  }
}

function normalizeAgentMessageForSession(
  input: AgentMessage,
  prefix = "Invalid AgentMessage",
  options: { requireTimestamp: boolean } = { requireTimestamp: true },
): AgentMessage {
  assertRecord(input, prefix);
  const role = input.role;
  if (typeof role !== "string" || !ALLOWED_AGENT_MESSAGE_ROLES.has(role)) {
    throw formatMessageError(prefix, `invalid role ${typeof role === "string" ? JSON.stringify(role) : "<missing>"}`);
  }
  const content = (input as { content?: unknown }).content;
  if (typeof content !== "string" && !Array.isArray(content)) {
    throw formatMessageError(prefix, "content must be a string or an array");
  }
  const timestamp = (input as { timestamp?: unknown }).timestamp;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    if (options.requireTimestamp) {
      throw formatMessageError(prefix, "timestamp must be a finite number");
    }
    return {
      ...input,
      timestamp: Date.now(),
    } as AgentMessage;
  }
  return input;
}

export function validateNewAgentMessageForSession(input: AgentMessage, prefix = "Invalid AgentMessage"): AgentMessage {
  return normalizeAgentMessageForSession(input, prefix, { requireTimestamp: true });
}

function normalizeLegacyAgentMessageForSession(input: AgentMessage, prefix = "Invalid legacy AgentMessage"): AgentMessage {
  return normalizeAgentMessageForSession(input, prefix, { requireTimestamp: false });
}

export function encodeAgentMessageForSession(message: AgentMessage, persistedAt = new Date().toISOString()): string {
  const normalized = validateNewAgentMessageForSession(message);
  const envelope: PersistedAgentMessageEnvelope = {
    schemaVersion: AGENT_MESSAGE_SCHEMA_VERSION,
    kind: "agent_message",
    message: normalized,
    persistedAt,
  };
  return JSON.stringify(envelope);
}

export function decodeAgentMessageFromSessionEntry(row: SessionEntryPayloadRow): AgentMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.payloadJson);
  } catch (error) {
    throw new Error(
      `Invalid session entry ${row.id} payload JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  assertRecord(parsed, `Invalid session entry ${row.id}`);

  if (parsed.schemaVersion === AGENT_MESSAGE_SCHEMA_VERSION || parsed.kind === "agent_message") {
    if (parsed.schemaVersion !== AGENT_MESSAGE_SCHEMA_VERSION || parsed.kind !== "agent_message") {
      throw new Error(`Invalid session entry ${row.id}: unsupported AgentMessage envelope`);
    }
    return validateNewAgentMessageForSession(
      parsed.message as AgentMessage,
      `Invalid session entry ${row.id} AgentMessage`,
    );
  }

  return normalizeLegacyAgentMessageForSession(parsed as unknown as AgentMessage, `Invalid legacy session entry ${row.id}`);
}

export function getAgentMessageRole(message: AgentMessage): string {
  return validateNewAgentMessageForSession(message).role as string;
}
