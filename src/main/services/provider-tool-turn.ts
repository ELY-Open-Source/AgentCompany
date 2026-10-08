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
  /** Why the provider's arguments were unusable; such a call is answered with this and never run. */
  argumentsError?: string;
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

/** Stop reasons that mean the model finished its turn, per wire format, as Pi maps them. */
export const FINISHED_STOP_REASONS = {
  chat: ["stop", "end", "tool_calls", "function_call"],
  anthropic: ["end_turn", "tool_use", "stop_sequence"],
  bedrock: ["end_turn", "tool_use", "stop_sequence"],
  gemini: ["STOP"],
} as const;

/** The error for a turn the provider cut short; acting on half a turn's text or arguments is worse than failing. */
export function incompleteTurn(reason: unknown): Error {
  const named = typeof reason === "string" && reason ? reason : "no stop reason";
  return new Error(`The provider stopped before finishing its answer (${named}); the partial answer was not used.`);
}

export function requireFinished(reason: unknown, finished: readonly string[]): void {
  if (typeof reason !== "string" || !finished.includes(reason)) throw incompleteTurn(reason);
}

const RAW_ARGUMENTS_SHOWN = 200;

/** A call whose arguments arrive as JSON text (chat, Responses): empty means none, the text must parse to an object. */
export function toolCallFromJson(id: string, name: string, raw: unknown): ToolCall {
  if (typeof raw !== "string" || !raw.trim()) return toolCallFromObject(id, name, raw === "" ? undefined : raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { id, name, arguments: {}, argumentsError: `not valid JSON (${error instanceof Error ? error.message : String(error)}): ${raw.slice(0, RAW_ARGUMENTS_SHOWN)}` };
  }
  return toolCallFromObject(id, name, parsed);
}

/** A call whose arguments arrive as an object (Anthropic, Bedrock, Gemini): absent means none, anything else must be an object. */
export function toolCallFromObject(id: string, name: string, raw: unknown): ToolCall {
  if (isRecord(raw)) return { id, name, arguments: raw };
  if (raw === undefined) return { id, name, arguments: {} };
  return { id, name, arguments: {}, argumentsError: `expected a JSON object, got ${jsonKind(raw)}` };
}

/** The answer to a call whose arguments could not be read, naming why so the model can resend them. */
export function unreadableArguments(call: ToolCall): string {
  return `ERROR: not run: the arguments of ${call.name} were ${call.argumentsError}. Call ${call.name} again with a complete JSON object.`;
}

function jsonKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value === "object" ? "an object" : `a ${typeof value}`;
}
