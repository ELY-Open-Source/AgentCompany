/**
 * B5 eval harness — driver spec.
 *
 * Two layers:
 *
 * 1. Self-tests (always run). An in-memory fixture exercises the loader
 *    contract, assertion judge, eval runner, and token ledger aggregation.
 *    This gives `pnpm test:eval` real signal even before any `.jsonl`
 *    fixture lands on disk. Zero fixture files = tier still exercised.
 *
 * 2. Fixture discovery (runs when `.jsonl` files exist). Every `*.jsonl`
 *    under `tests/eval/fixtures/` is discovered and runs through the
 *    judge. If the fixtures directory is missing we treat that as "no
 *    fixtures yet", return an empty list, and let the self-tests carry
 *    the signal on their own — we do NOT synthesize placeholder fixtures.
 *
 * Karpathy rule: bad fixture data must crash loud at the loader. The
 * harness itself is validated by self-tests so a breakage there never
 * hides behind an empty fixtures directory.
 */

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { judgeAssertions } from "./assertion-judge.js";
import { runEval } from "./eval-runner.js";
import { loadFixture } from "./fixture-loader.js";
import type {
  Assertion,
  AssistantTurn,
  FixtureFile,
  UserTurn,
} from "./types.js";

const FIXTURE_DIR = join(__dirname, "fixtures");

async function listFixtures(): Promise<string[]> {
  if (!existsSync(FIXTURE_DIR)) return [];
  const entries = await readdir(FIXTURE_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => join(FIXTURE_DIR, entry.name))
    .sort();
}

function buildInMemoryFixture(assertions: Assertion[]): FixtureFile {
  const userTurn: UserTurn = {
    type: "turn",
    turnIndex: 0,
    role: "user",
    content: [{ type: "text", text: "hire a writer" }],
  };
  const assistantTurn: AssistantTurn = {
    type: "turn",
    turnIndex: 1,
    role: "assistant",
    content: [
      { type: "text", text: "Hiring a writer now." },
      {
        type: "toolCall",
        id: "call_001",
        name: "hire_agent",
        arguments: { role: "writer", seniority: "senior" },
      },
    ],
    tokenLedger: {
      input: 120,
      cache_read: 40,
      cache_creation: 10,
      output: 60,
    },
  };
  return {
    meta: {
      type: "meta",
      fixtureId: "self-test/in-memory",
      piAgentCoreVersion: "0.0.0-self-test",
      recordedAt: "2026-04-20T00:00:00.000Z",
      scenario: "in-memory self-test fixture",
      systemPromptHash: "sha256:self-test",
    },
    turns: [userTurn, assistantTurn],
    assertions,
  };
}

describe("harness self-test (in-memory fixture)", () => {
  it("passes when every assertion matches the recorded trace", () => {
    const fixture = buildInMemoryFixture([
      { kind: "tool_called", name: "hire_agent", min_count: 1 },
      {
        kind: "tool_call_arg_matches",
        name: "hire_agent",
        arg_path: "role",
        matches_regex: "^writer$",
      },
      { kind: "no_tool_called", name: "write_plan" },
      {
        kind: "message_contains_substring",
        role: "assistant",
        substring: "Hiring a writer",
      },
      { kind: "trace_max_turns", max: 5 },
    ]);
    const result = runEval(fixture);
    expect(result.passed).toBe(true);
    expect(result.fixtureId).toBe("self-test/in-memory");
    expect(result.assertions).toHaveLength(5);
    expect(result.assertions.every((r) => r.passed)).toBe(true);
    expect(result.tokenLedger).toEqual({
      input: 120,
      cache_read: 40,
      cache_creation: 10,
      output: 60,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("fails with a precise reason when an assertion misses", () => {
    const fixture = buildInMemoryFixture([
      { kind: "tool_called", name: "write_plan", min_count: 1 },
      { kind: "no_tool_called", name: "hire_agent" },
      { kind: "trace_max_turns", max: 1 },
    ]);
    const result = runEval(fixture);
    expect(result.passed).toBe(false);
    const reasons = result.assertions.map((r) => r.reason ?? "");
    expect(reasons[0]).toContain('expected at least 1 call(s) to "write_plan"');
    expect(reasons[1]).toContain('expected no call to "hire_agent"');
    expect(reasons[2]).toContain("trace has 2 turns, max allowed is 1");
  });

  it("message_does_not_contain_substring passes when substring is absent", () => {
    const fixture = buildInMemoryFixture([
      {
        kind: "message_does_not_contain_substring",
        role: "assistant",
        substring: "node -e",
      },
    ]);
    const result = runEval(fixture);
    expect(result.passed).toBe(true);
    expect(result.assertions[0]?.passed).toBe(true);
  });

  it("message_does_not_contain_substring fails when substring is present", () => {
    const fixture = buildInMemoryFixture([
      {
        kind: "message_does_not_contain_substring",
        role: "assistant",
        substring: "Hiring a writer",
      },
    ]);
    const result = runEval(fixture);
    expect(result.passed).toBe(false);
    expect(result.assertions[0]?.reason).toContain(
      'a assistant message contained forbidden substring "Hiring a writer"',
    );
  });

  it("judgeAssertions is a pure function of (assertions, turns)", () => {
    const fixture = buildInMemoryFixture([]);
    const first = judgeAssertions(
      [{ kind: "tool_called", name: "hire_agent" }],
      fixture.turns,
    );
    const second = judgeAssertions(
      [{ kind: "tool_called", name: "hire_agent" }],
      fixture.turns,
    );
    expect(first).toEqual(second);
    expect(first[0]?.passed).toBe(true);
  });
});

const fixturePaths = await listFixtures();

describe.each(fixturePaths)("eval fixture %s", (fixturePath) => {
  it("passes all assertions", async () => {
    const fixture = await loadFixture(fixturePath);
    const result = runEval(fixture);
    if (!result.passed) {
      const failures = result.assertions
        .filter((assertion) => !assertion.passed)
        .map((assertion) => `- ${assertion.assertion.kind}: ${assertion.reason ?? "<no reason>"}`)
        .join("\n");
      throw new Error(
        `fixture ${result.fixtureId} failed:\n${failures}\ntoken ledger: ${JSON.stringify(result.tokenLedger)}`,
      );
    }
    expect(result.passed).toBe(true);
  });
});
