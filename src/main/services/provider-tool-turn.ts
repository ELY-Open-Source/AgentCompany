import type { ProviderObservedRateLimitState } from "../../shared/provider-runtime-domain";
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

/** The provider's own assistant output, sent back unchanged so reasoning, encrypted reasoning and signatures survive tool turns. */
export type AssistantReplay =
  | { format: "responses" | "anthropic" | "bedrock" | "gemini"; content: unknown[] }
  | { format: "chat"; content: JsonRecord };

export type AssistantTurnMessage = { role: "assistant"; text: string; toolCalls: ToolCall[]; replay?: AssistantReplay };

export type AgentTurnMessage =
  | { role: "user"; text: string }
  | AssistantTurnMessage
  | { role: "tool"; results: Array<{ toolCallId: string; toolName: string; output: string }>; followUp?: string };

/** The message's replay when it came from this wire format; a replay from another format is a bug, not something to drop. */
export function replayIn(message: AssistantTurnMessage, format: AssistantReplay["format"]): AssistantReplay | null {
  if (!message.replay) return null;
  if (message.replay.format !== format) throw new Error(`An assistant turn in ${message.replay.format} format cannot be sent to a ${format} provider.`);
  return message.replay;
}

export interface AgentTurnResult {
  text: string;
  toolCalls: ToolCall[];
  replay?: AssistantReplay;
  rawResponseJson: string;
  /** Rate-limit headers of the response, when the provider sent any. */
  rateLimitState?: ProviderObservedRateLimitState | null;
}

/** Resolved per-request credential, already refreshed if it was an OAuth token. */
export interface TurnCredential {
  apiKey?: string;
  accessToken?: string;
  accountId?: string;
  projectId?: string;
  enterpriseUrl?: string | null;
  /** Base URL for Azure and custom OpenAI/Anthropic-compatible endpoints. */
  baseUrl?: string;
  deployment?: string;
  /** AWS Bedrock. */
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string | null;
  /** Vertex AI service-account JSON. */
  serviceAccountJson?: string;
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
