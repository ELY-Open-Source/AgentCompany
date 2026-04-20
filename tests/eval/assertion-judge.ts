/**
 * Assertion judge for B5 eval harness.
 *
 * Evaluates a list of structural `Assertion` records against a recorded
 * fixture trace. This is the cheap, deterministic tier — it understands tool
 * call names, counts, order, and substrings. Semantic judgment (tone, plan
 * quality) is out of scope and handled by the LLM-as-judge tier described in
 * B5.1.
 *
 * Design notes:
 * - Pure function of (assertions, turns) → AssertionResult[]. No I/O.
 * - Never throws. Every assertion either passes or fails with a `reason`.
 *   The runner aggregates these into a single `EvalResult`.
 * - `tool_call_arg_matches.arg_path` supports dotted paths through nested
 *   objects and numeric indexes through arrays (`items.0.name`). If the path
 *   misses or resolves to a non-string, the assertion fails with a reason.
 */

import type { ToolCall } from "@mariozechner/pi-ai";
import type {
  Assertion,
  AssertionResult,
  AssistantTurn,
  TraceTurn,
} from "./types.js";

interface ToolCallOccurrence {
  toolCall: ToolCall;
  /** Ordinal index among all tool calls across the full trace. */
  ordinal: number;
}

function collectToolCalls(turns: TraceTurn[]): ToolCallOccurrence[] {
  const occurrences: ToolCallOccurrence[] = [];
  for (const turn of turns) {
    if (turn.role !== "assistant") continue;
    const assistantTurn = turn as AssistantTurn;
    for (const block of assistantTurn.content) {
      if (block.type === "toolCall") {
        occurrences.push({
          toolCall: block,
          ordinal: occurrences.length,
        });
      }
    }
  }
  return occurrences;
}

function resolveArgPath(root: unknown, path: string): unknown {
  const parts = path.split(".");
  let cursor: unknown = root;
  for (const part of parts) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function evaluateOne(
  assertion: Assertion,
  turns: TraceTurn[],
  toolCalls: ToolCallOccurrence[],
): AssertionResult {
  switch (assertion.kind) {
    case "tool_called": {
      const matches = toolCalls.filter(
        (occ) => occ.toolCall.name === assertion.name,
      );
      const minCount = assertion.min_count ?? 1;
      if (matches.length < minCount) {
        return {
          assertion,
          passed: false,
          reason: `expected at least ${minCount} call(s) to "${assertion.name}", saw ${matches.length}`,
        };
      }
      if (assertion.max_count !== undefined && matches.length > assertion.max_count) {
        return {
          assertion,
          passed: false,
          reason: `expected at most ${assertion.max_count} call(s) to "${assertion.name}", saw ${matches.length}`,
        };
      }
      if (assertion.order !== undefined) {
        const match = matches.find((occ) => occ.ordinal === assertion.order);
        if (!match) {
          const seenOrdinals = matches.map((occ) => occ.ordinal).join(",");
          return {
            assertion,
            passed: false,
            reason: `expected "${assertion.name}" at ordinal ${assertion.order}, matching calls at [${seenOrdinals}]`,
          };
        }
      }
      return { assertion, passed: true };
    }
    case "no_tool_called": {
      const matches = toolCalls.filter(
        (occ) => occ.toolCall.name === assertion.name,
      );
      if (matches.length > 0) {
        return {
          assertion,
          passed: false,
          reason: `expected no call to "${assertion.name}", saw ${matches.length}`,
        };
      }
      return { assertion, passed: true };
    }
    case "message_contains_substring": {
      for (const turn of turns) {
        if (turn.role !== assertion.role) continue;
        // UserTurn and AssistantTurn both expose .content; the `role` guard
        // above restricts us to those variants, so no cast is needed.
        const content = turn.content;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
          if (
            block &&
            typeof block === "object" &&
            (block as { type?: string }).type === "text" &&
            typeof (block as { text?: unknown }).text === "string" &&
            ((block as { text: string }).text).includes(assertion.substring)
          ) {
            return { assertion, passed: true };
          }
        }
      }
      return {
        assertion,
        passed: false,
        reason: `no ${assertion.role} message contained substring "${assertion.substring}"`,
      };
    }
    case "message_does_not_contain_substring": {
      for (const turn of turns) {
        if (turn.role !== assertion.role) continue;
        const content = turn.content;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
          if (
            block &&
            typeof block === "object" &&
            (block as { type?: string }).type === "text" &&
            typeof (block as { text?: unknown }).text === "string" &&
            ((block as { text: string }).text).includes(assertion.substring)
          ) {
            return {
              assertion,
              passed: false,
              reason: `a ${assertion.role} message contained forbidden substring "${assertion.substring}"`,
            };
          }
        }
      }
      return { assertion, passed: true };
    }
    case "tool_call_arg_matches": {
      const matches = toolCalls.filter(
        (occ) => occ.toolCall.name === assertion.name,
      );
      if (matches.length === 0) {
        return {
          assertion,
          passed: false,
          reason: `no tool call named "${assertion.name}" to match arg against`,
        };
      }
      let regex: RegExp;
      try {
        regex = new RegExp(assertion.matches_regex);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return {
          assertion,
          passed: false,
          reason: `invalid regex "${assertion.matches_regex}": ${detail}`,
        };
      }
      for (const occurrence of matches) {
        const value = resolveArgPath(occurrence.toolCall.arguments, assertion.arg_path);
        if (typeof value === "string" && regex.test(value)) {
          return { assertion, passed: true };
        }
      }
      return {
        assertion,
        passed: false,
        reason: `no "${assertion.name}" call had arg "${assertion.arg_path}" matching /${assertion.matches_regex}/`,
      };
    }
    case "trace_max_turns": {
      if (turns.length > assertion.max) {
        return {
          assertion,
          passed: false,
          reason: `trace has ${turns.length} turns, max allowed is ${assertion.max}`,
        };
      }
      return { assertion, passed: true };
    }
  }
}

export function judgeAssertions(
  assertions: Assertion[],
  turns: TraceTurn[],
): AssertionResult[] {
  const toolCalls = collectToolCalls(turns);
  return assertions.map((assertion) => evaluateOne(assertion, turns, toolCalls));
}
