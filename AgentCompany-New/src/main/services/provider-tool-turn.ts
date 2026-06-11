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

/** How the backend should treat tool calls this turn. "required" compels the
 * model to emit at least one tool call (no prose-only escape) — used to force a
 * concrete action so a weak model cannot ramble its way to a silent no-op. */
export type ToolChoice = "auto" | "required";

export interface ProviderToolTurnInput {
  credential: TurnCredential;
  model: string;
  instructions: string | null;
  messages: AgentTurnMessage[];
  tools: ToolDefinition[];
  toolChoice?: ToolChoice;
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
