/**
 * Fixture recorder CLI for B5 eval harness.
 *
 * Entrypoint: `pnpm eval:record -- --out tests/eval/fixtures/<id>.jsonl`
 *
 * This CLI is a *scaffold*: it accepts a scenario config path and an output
 * path, validates the config shape, and writes a stub fixture containing
 * only the meta header plus an empty assertions block. The real recording
 * loop — which drives `pi-agent-core` against a real provider with the
 * AgentCompany system prompt and tool catalogue — lives in a follow-up
 * commit. Tonight's scope is the harness skeleton; the user populates
 * `tests/eval/fixtures/` by running the full recorder once it is wired.
 *
 * Why a stub and not a full recording loop tonight:
 * - Wiring the full loop requires importing the AgentCompany worker's
 *   system prompt builder and tool registry. Those modules live in
 *   `src/main/` and depend on the Electron runtime; importing them from a
 *   Node CLI would require either a recorder-only entrypoint or a vite
 *   build step. Both are bigger than tonight's surgical scope.
 * - Keeping the CLI as a stub today forces a deliberate follow-up rather
 *   than silently recording fixtures from the wrong context — a Karpathy
 *   "let it crash" moment.
 *
 * Usage:
 *   tsx tests/eval/record-fixture.ts \
 *     --fixture-id ceo-team-building-empty \
 *     --scenario "Empty company, CEO bootstrap" \
 *     --out tests/eval/fixtures/ceo-team-building-empty.jsonl
 */

import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import type { FixtureMeta } from "./types.js";

interface CliArgs {
  fixtureId: string;
  scenario: string;
  out: string;
  systemPromptPreview: string;
}

function readArg(args: string[], flag: string, required: boolean): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) {
    if (required) {
      throw new Error(`record-fixture: missing required flag ${flag}`);
    }
    return undefined;
  }
  const value = args[idx + 1];
  if (typeof value !== "string" || value.startsWith("--")) {
    throw new Error(`record-fixture: flag ${flag} requires a value`);
  }
  return value;
}

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);
  const fixtureId = readArg(args, "--fixture-id", true)!;
  const scenario = readArg(args, "--scenario", true)!;
  const out = readArg(args, "--out", true)!;
  const systemPromptPreview = readArg(args, "--system-prompt-preview", false) ?? "";
  return { fixtureId, scenario, out, systemPromptPreview };
}

function resolvePiAgentCoreVersion(): string {
  const require = createRequire(import.meta.url);
  // Narrow shape of the pi-agent-core package.json read at runtime.
  const pkg = require("@mariozechner/pi-agent-core/package.json") as { version?: unknown };
  if (typeof pkg.version !== "string") {
    throw new Error(
      "record-fixture: could not resolve @mariozechner/pi-agent-core version",
    );
  }
  return pkg.version;
}

function buildMeta(args: CliArgs): FixtureMeta {
  const hash = createHash("sha256").update(args.systemPromptPreview).digest("hex");
  return {
    type: "meta",
    fixtureId: args.fixtureId,
    piAgentCoreVersion: resolvePiAgentCoreVersion(),
    recordedAt: new Date().toISOString(),
    scenario: args.scenario,
    systemPromptHash: `sha256:${hash}`,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const meta = buildMeta(args);
  const lines: string[] = [
    JSON.stringify(meta),
    JSON.stringify({ type: "assertions", assertions: [] }),
  ];
  const outPath = resolve(args.out);
  await writeFile(outPath, `${lines.join("\n")}\n`, "utf8");
  process.stdout.write(
    `record-fixture: wrote stub fixture ${args.fixtureId} to ${outPath}\n` +
      `record-fixture: NEXT STEP — replace the stub with recorded turns by running the full recorder (see tests/eval/README.md).\n`,
  );
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`record-fixture: ${detail}\n`);
  process.exit(1);
});
