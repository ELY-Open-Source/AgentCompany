/**
 * Type definitions for the B5 minimal eval harness.
 *
 * Design invariants:
 * - Fixtures are recorded LLM traces (history real runs), not synthesized mocks.
 *   A fixture is the serialized truth of a turn that actually happened against
 *   a real provider; replaying it tells us whether the *harness* still reaches
 *   the same tool-call shape given the same prompt/context.
 * - Every type here reuses `@mariozechner/pi-ai` primitives verbatim. Shadow
 *   types are forbidden; if pi-ai changes its `AssistantMessage` shape, this
 *   harness breaks loud — that is the intent.
 * - No runtime field here is optional for "fallback reasons". If a field is
 *   optional, it encodes real optionality of the source data (e.g. a turn
 *   record that does not carry usage because it is a user turn).
 */

import type {
  AssistantMessage,
  ToolResultMessage,
  UserMessage,
} from "@mariozechner/pi-ai";

/**
 * Top-level fixture file meta header.
 *
 * Every JSONL fixture begins with exactly one `meta` record. The runner will
 * throw if the first line is not a meta record — no fallback default metadata
 * is synthesized.
 */
export interface FixtureMeta {
  type: "meta";
  /** Stable fixture identifier; used as the scenario name in eval output. */
  fixtureId: string;
  /** pi-agent-core version used to record this fixture. */
  piAgentCoreVersion: string;
  /** ISO-8601 timestamp when the fixture was recorded against a real provider. */
  recordedAt: string;
  /** Short human description of what the scenario exercises. */
  scenario: string;
  /** sha256 of the system prompt used at recording time. Used to detect drift. */
  systemPromptHash: string;
}

/**
 * Token ledger captured for assistant turns.
 *
 * Shape mirrors `AssistantMessage.usage` but uses snake_case fields that match
 * the JSONL spec printed in `README.md`. The mapping is 1:1 with pi-ai's
 * `Usage` primitives (`input`, `output`, `cacheRead`, `cacheWrite`) — renamed
 * for the on-disk format to stay provider-neutral.
 */
export interface TokenLedger {
  input: number;
  cache_read: number;
  cache_creation: number;
  output: number;
}

export interface UserTurn {
  type: "turn";
  turnIndex: number;
  role: "user";
  /** Verbatim user content blocks from the real recording. */
  content: UserMessage["content"];
}

export interface AssistantTurn {
  type: "turn";
  turnIndex: number;
  role: "assistant";
  /** Verbatim assistant content blocks (text / thinking / toolCall). */
  content: AssistantMessage["content"];
  /** Token ledger recorded for this assistant turn. Required on assistant turns. */
  tokenLedger: TokenLedger;
}

export interface ToolResultTurn {
  type: "turn";
  turnIndex: number;
  role: "toolResult";
  toolUseId: string;
  content: ToolResultMessage["content"];
}

export type TraceTurn = UserTurn | AssistantTurn | ToolResultTurn;

/**
 * Structural assertions that can be evaluated against a replayed trace.
 *
 * Deliberately minimal: assertions express tool-call shape, order, count, and
 * textual substrings. Semantic behavior checks live in `semanticRubric` below,
 * where each dimension ties a human-readable rubric to concrete transcript
 * evidence that CI can verify without a provider key.
 */
export type Assertion =
  | {
      kind: "tool_called";
      name: string;
      min_count?: number;
      max_count?: number;
      /** Ordinal position in the trace (0-based) among all tool calls. */
      order?: number;
    }
  | { kind: "no_tool_called"; name: string }
  | {
      kind: "message_contains_substring";
      role: "assistant" | "user";
      substring: string;
    }
  | {
      /**
       * Negative substring check. Fails when *any* message of `role` contains
       * `substring`; used to pin post-refactor invariants where a particular
       * pattern must disappear from the trace (for example, asserting that a
       * CEO bootstrap no longer emits `node -e` after C4).
       */
      kind: "message_does_not_contain_substring";
      role: "assistant" | "user";
      substring: string;
    }
  | {
      kind: "tool_call_arg_matches";
      name: string;
      /** Dotted JSON path into the tool call's arguments object, e.g. "agent.role". */
      arg_path: string;
      /** ECMAScript regex source evaluated against the argument string. */
      matches_regex: string;
    }
  | { kind: "trace_max_turns"; max: number };

export interface AssertionsBlock {
  type: "assertions";
  assertions: Assertion[];
  semanticRubric: SemanticRubricDimension[];
}

export interface SemanticRubricDimension {
  /** Stable kebab-case identifier within the fixture. */
  id: string;
  /** Human-readable semantic question being graded. */
  question: string;
  /** Concrete description of a passing answer. */
  passRubric: string;
  /** Concrete description of a failing answer. */
  failRubric: string;
  /** Required transcript evidence. Every item must appear in assistant text. */
  mustContain: string[];
  /** Forbidden transcript evidence. Any matching item fails the dimension. */
  mustNotContain?: string[];
}

/**
 * A JSONL fixture file is parsed into exactly one of these records per line.
 * The loader rejects files that do not begin with `meta` and end with
 * `assertions`.
 */
export type FixtureLine = FixtureMeta | TraceTurn | AssertionsBlock;

/**
 * Parsed fixture file ready to be replayed by the runner.
 */
export interface FixtureFile {
  meta: FixtureMeta;
  turns: TraceTurn[];
  assertions: Assertion[];
  semanticRubric: SemanticRubricDimension[];
}

/**
 * Per-assertion outcome within a single eval run.
 */
export interface AssertionResult {
  assertion: Assertion;
  passed: boolean;
  /** Populated when `passed === false`; concise human-readable explanation. */
  reason?: string;
}

export interface SemanticRubricResult {
  dimensionId: string;
  passed: boolean;
  evidence: string[];
  /** Populated when `passed === false`; concise human-readable explanation. */
  reason?: string;
}

/**
 * Result of evaluating one fixture against the current code path.
 */
export interface EvalResult {
  fixtureId: string;
  passed: boolean;
  assertions: AssertionResult[];
  semanticRubric: SemanticRubricResult[];
  /** Aggregated token ledger summed across all assistant turns in the fixture. */
  tokenLedger: TokenLedger;
  /** Wall-clock duration of the replay, in milliseconds. */
  durationMs: number;
}
