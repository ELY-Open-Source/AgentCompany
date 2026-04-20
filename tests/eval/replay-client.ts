/**
 * Replay client for B5 eval harness.
 *
 * Swaps in for `streamSimple` (the pi-ai LLM call) during eval runs. Instead
 * of hitting a real provider, it replays the assistant turns from the fixture
 * in order, emitting the `AssistantMessageEvent` protocol expected by
 * `pi-agent-core`.
 *
 * Hard contract (Karpathy rule: no fallback):
 * - If the agent loop asks for the Nth assistant turn and the fixture has
 *   fewer assistant turns, the replay client THROWS. It does not return a
 *   placeholder response, does not return an empty assistant message, and
 *   does not invent an `errorMessage`. Missing fixture = bug in fixture, and
 *   the runner must surface that loud.
 * - The client ignores the incoming `context.messages` because the fixture
 *   is the source of truth. A future harness tier (B5.1 or later) can diff
 *   the incoming messages against the fixture's recorded prior messages to
 *   detect context drift — out of scope tonight.
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import {
  AssistantMessageEventStream,
  createAssistantMessageEventStream,
} from "@mariozechner/pi-ai";
import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { AssistantTurn, FixtureFile } from "./types.js";

function collectAssistantTurns(fixture: FixtureFile): AssistantTurn[] {
  return fixture.turns.filter(
    (turn): turn is AssistantTurn => turn.role === "assistant",
  );
}

function buildAssistantMessage(
  turn: AssistantTurn,
  modelId: string,
  provider: string,
  api: string,
): AssistantMessage {
  const ledger = turn.tokenLedger;
  const totalTokens =
    ledger.input + ledger.cache_read + ledger.cache_creation + ledger.output;
  const hasToolCall = turn.content.some((block) => block.type === "toolCall");
  return {
    role: "assistant",
    content: turn.content,
    api,
    provider,
    model: modelId,
    usage: {
      input: ledger.input,
      output: ledger.output,
      cacheRead: ledger.cache_read,
      cacheWrite: ledger.cache_creation,
      totalTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: hasToolCall ? "toolUse" : "stop",
    timestamp: Date.now(),
  };
}

function pushRecordedMessage(
  stream: AssistantMessageEventStream,
  message: AssistantMessage,
): void {
  stream.push({ type: "start", partial: message });
  const reason = (message.stopReason === "toolUse" || message.stopReason === "length"
    ? message.stopReason
    : "stop") as "stop" | "toolUse" | "length";
  stream.push({ type: "done", reason, message });
  stream.end(message);
}

/**
 * Create a replay stream function bound to a fixture.
 *
 * The returned function tracks its own cursor. Each invocation consumes the
 * next assistant turn. If the caller exhausts the fixture, the next
 * invocation throws.
 */
export function createReplayStreamFn(fixture: FixtureFile): StreamFn {
  const assistantTurns = collectAssistantTurns(fixture);
  let cursor = 0;

  return ((model, _context, _options) => {
    if (cursor >= assistantTurns.length) {
      throw new Error(
        `replay-client: fixture "${fixture.meta.fixtureId}" exhausted after ${assistantTurns.length} assistant turns; agent requested turn ${cursor + 1}`,
      );
    }
    const turn = assistantTurns[cursor];
    cursor += 1;
    if (!turn) {
      throw new Error(
        `replay-client: internal cursor error at position ${cursor - 1}`,
      );
    }
    const message = buildAssistantMessage(
      turn,
      model.id,
      model.provider,
      model.api,
    );
    const stream = createAssistantMessageEventStream();
    pushRecordedMessage(stream, message);
    return stream;
  }) satisfies StreamFn;
}
