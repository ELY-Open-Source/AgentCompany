/**
 * B5 eval harness — driver spec.
 *
 * This spec discovers every `*.jsonl` fixture under `tests/eval/fixtures/`
 * and runs it through the assertion judge. If there are zero fixtures, the
 * spec file has zero tests — vitest is invoked with `--passWithNoTests`
 * from the `test:eval` script so this is a green no-op until the user
 * records real fixtures.
 *
 * The harness does NOT synthesize placeholder fixtures under any
 * circumstance. An empty `fixtures/` directory is a real state — the tier
 * is simply not yet exercising anything — and the green run reflects that
 * honestly.
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadFixture } from "./fixture-loader.js";
import { runEval } from "./eval-runner.js";

const FIXTURE_DIR = join(__dirname, "fixtures");

async function listFixtures(): Promise<string[]> {
  const entries = await readdir(FIXTURE_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => join(FIXTURE_DIR, entry.name))
    .sort();
}

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
