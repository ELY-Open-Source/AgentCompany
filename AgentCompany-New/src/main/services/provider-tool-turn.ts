/**
 * Shared contract for a single tool-use ("function calling") turn against any
 * provider backend. The agent loop maintains a normalized conversation
 * ({@link AgentTurnMessage}[]) plus the requested {@link ToolDefinition}s; each
 * provider's turn function (under `provider-tool-turns/`) translates that into
 * the backend's wire format, calls the live endpoint, and parses the reply plus
 * any tool calls back into {@link AgentTurnResult}.
 */
import { isRecord, type JsonRecord } from "./provider-http";

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  parameters: JsonRecord;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: JsonRecord;
}

export type AgentTurnMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: ToolCall[] }
  | { role: "tool"; results: Array<{ toolCallId: string; toolName: string; output: string }> };

export interface AgentTurnResult {
  text: string;
  toolCalls: ToolCall[];
  rawResponseJson: string;
}

/** Resolved per-request credential, already refreshed if it was an OAuth token. */
export interface TurnCredential {
  apiKey?: string;
  accessToken?: string;
  accountId?: string;
  projectId?: string;
  enterpriseUrl?: string | null;
}

export interface ProviderToolTurnInput {
  credential: TurnCredential;
  model: string;
  instructions: string | null;
  messages: AgentTurnMessage[];
  tools: ToolDefinition[];
}

export type ToolTurnFn = (input: ProviderToolTurnInput) => Promise<AgentTurnResult>;

/** Coerce a tool-call argument payload (string or object) into a JSON object. */
export function parseArguments(value: unknown): JsonRecord {
  if (isRecord(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (isRecord(parsed)) return parsed;
    } catch {
      return {};
    }
  }
  return {};
}
