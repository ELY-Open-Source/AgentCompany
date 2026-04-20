/**
 * Eval runner for B5 harness.
 *
 * Given a parsed `FixtureFile`, produces an `EvalResult` by:
 *  1. Summing the token ledger across all recorded assistant turns.
 *  2. Running the assertion judge against the recorded turns.
 *  3. Measuring wall-clock duration of steps (1)–(2).
 *
 * Tonight's scope deliberately evaluates assertions against the RECORDED
 * trace, not a live replay-driven agent loop. That keeps the harness
 * useful as a snapshot-regression tool the moment the first fixture lands,
 * without wiring in the full `pi-agent-core` Agent loop (which requires
 * tools + hooks and is better done incrementally once we have fixtures).
 *
 * The replay-client + fixture-loader are written now so the live-replay
 * tier can be added in B5.1 without reshaping types.
 */

import { judgeAssertions } from "./assertion-judge.js";
import type { EvalResult, FixtureFile, TokenLedger } from "./types.js";

const ZERO_LEDGER: TokenLedger = {
  input: 0,
  cache_read: 0,
  cache_creation: 0,
  output: 0,
};

function sumLedger(fixture: FixtureFile): TokenLedger {
  return fixture.turns.reduce<TokenLedger>((acc, turn) => {
    if (turn.role !== "assistant") return acc;
    return {
      input: acc.input + turn.tokenLedger.input,
      cache_read: acc.cache_read + turn.tokenLedger.cache_read,
      cache_creation: acc.cache_creation + turn.tokenLedger.cache_creation,
      output: acc.output + turn.tokenLedger.output,
    };
  }, ZERO_LEDGER);
}

export function runEval(fixture: FixtureFile): EvalResult {
  const start = Date.now();
  const results = judgeAssertions(fixture.assertions, fixture.turns);
  const tokenLedger = sumLedger(fixture);
  const durationMs = Date.now() - start;
  const passed = results.every((result) => result.passed);

  return {
    fixtureId: fixture.meta.fixtureId,
    passed,
    assertions: results,
    tokenLedger,
    durationMs,
  };
}
