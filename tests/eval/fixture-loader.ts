/**
 * Fixture loader for B5 eval harness.
 *
 * Reads a JSONL file and parses it into a strongly-typed `FixtureFile`.
 *
 * Non-negotiable invariants:
 * - The first non-empty line MUST be a `meta` record. Otherwise the loader
 *   throws — no synthesized default metadata.
 * - The last non-empty line MUST be an `assertions` record. Otherwise throw.
 * - Turn `turnIndex` must be strictly increasing starting at 0. Gaps or
 *   duplicates throw.
 * - Unknown `type` values throw. We do not silently ignore junk lines.
 *
 * The loader does no I/O beyond `readFile`. It does not tolerate partial or
 * corrupt fixtures by "best-effort parsing" — Karpathy rule: bad data must
 * crash loud so the user fixes the fixture, not the harness.
 */

import { readFile } from "node:fs/promises";
import type {
  AssertionsBlock,
  FixtureFile,
  FixtureLine,
  FixtureMeta,
  TraceTurn,
} from "./types.js";

function parseLine(raw: string, lineNumber: number, source: string): FixtureLine {
  try {
    return JSON.parse(raw) as FixtureLine;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `fixture ${source}: line ${lineNumber} is not valid JSON: ${detail}`,
    );
  }
}

function isMeta(value: FixtureLine): value is FixtureMeta {
  return value.type === "meta";
}

function isAssertions(value: FixtureLine): value is AssertionsBlock {
  return value.type === "assertions";
}

function isTurn(value: FixtureLine): value is TraceTurn {
  return value.type === "turn";
}

export async function loadFixture(path: string): Promise<FixtureFile> {
  const raw = await readFile(path, "utf8");
  const lines = raw
    .split("\n")
    .map((line, idx) => ({ line: line.trim(), lineNumber: idx + 1 }))
    .filter((entry) => entry.line.length > 0);

  if (lines.length < 3) {
    throw new Error(
      `fixture ${path}: must contain at least a meta record, one turn, and an assertions record`,
    );
  }

  const parsed: { record: FixtureLine; lineNumber: number }[] = lines.map(
    ({ line, lineNumber }) => ({
      record: parseLine(line, lineNumber, path),
      lineNumber,
    }),
  );

  const first = parsed[0];
  if (!first || !isMeta(first.record)) {
    throw new Error(
      `fixture ${path}: first line must be a {"type":"meta"} record`,
    );
  }
  const last = parsed[parsed.length - 1];
  if (!last || !isAssertions(last.record)) {
    throw new Error(
      `fixture ${path}: last line must be a {"type":"assertions"} record`,
    );
  }

  const turns: TraceTurn[] = [];
  for (let i = 1; i < parsed.length - 1; i += 1) {
    const entry = parsed[i];
    if (!entry) {
      throw new Error(`fixture ${path}: internal index error`);
    }
    if (!isTurn(entry.record)) {
      throw new Error(
        `fixture ${path}: line ${entry.lineNumber} has unexpected type "${entry.record.type}" (only turn records allowed between meta and assertions)`,
      );
    }
    const expectedIndex = turns.length;
    if (entry.record.turnIndex !== expectedIndex) {
      throw new Error(
        `fixture ${path}: line ${entry.lineNumber} has turnIndex=${entry.record.turnIndex}, expected ${expectedIndex}`,
      );
    }
    turns.push(entry.record);
  }

  return {
    meta: first.record,
    turns,
    assertions: last.record.assertions,
  };
}
