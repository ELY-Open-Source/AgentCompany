/**
 * Eval runner for the recorded-fixture harness.
 *
 * A fixture now runs through the real `pi-agent-core` Agent loop with a
 * replay stream and recorded tool-result executors. Assertions are judged
 * against the replayed transcript that the Agent produced, so tool-call
 * ordering, tool-result handoff, token ledger aggregation, and assertion
 * evaluation share the same path the worker uses in production.
 */

import { judgeAssertions } from "./assertion-judge.js";
import { judgeSemanticRubric } from "./semantic-rubric-judge.js";
import { replayFixtureThroughAgent } from "./tool-loop-replay.js";
import type { EvalResult, FixtureFile, TokenLedger, TraceTurn } from "./types.js";

export interface RunEvalOptions {
  systemPrompt?: string;
}

const ZERO_LEDGER: TokenLedger = {
  input: 0,
  cache_read: 0,
  cache_creation: 0,
  output: 0,
};

function sumLedger(turns: TraceTurn[]): TokenLedger {
  return turns.reduce<TokenLedger>((acc, turn) => {
    if (turn.role !== "assistant") return acc;
    return {
      input: acc.input + turn.tokenLedger.input,
      cache_read: acc.cache_read + turn.tokenLedger.cache_read,
      cache_creation: acc.cache_creation + turn.tokenLedger.cache_creation,
      output: acc.output + turn.tokenLedger.output,
    };
  }, ZERO_LEDGER);
}

export async function runEval(
  fixture: FixtureFile,
  options: RunEvalOptions = {},
): Promise<EvalResult> {
  const start = Date.now();
  const replayedTurns = await replayFixtureThroughAgent(
    fixture,
    options.systemPrompt ?? "",
  );
  const results = judgeAssertions(fixture.assertions, replayedTurns);
  const semanticResults = judgeSemanticRubric(fixture.semanticRubric, replayedTurns);
  const tokenLedger = sumLedger(replayedTurns);
  const durationMs = Date.now() - start;
  const passed =
    results.every((result) => result.passed) &&
    semanticResults.every((result) => result.passed);

  return {
    fixtureId: fixture.meta.fixtureId,
    passed,
    assertions: results,
    semanticRubric: semanticResults,
    tokenLedger,
    durationMs,
  };
}
