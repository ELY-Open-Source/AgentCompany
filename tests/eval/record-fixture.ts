/**
 * Fixture recorder CLI for the B5 eval harness.
 *
 * Entrypoint:
 *   pnpm eval:record \
 *     --scenario <human-description> \
 *     --fixture-id <stable-id> \
 *     --provider <anthropic|openai|google> \
 *     --model <model-id> \
 *     --system-prompt-file <path> \
 *     --user-message-file <path> \
 *     --output tests/eval/fixtures/<id>.jsonl
 *
 * What this CLI does:
 *
 * 1. Reads the system prompt and the user message from the paths given on
 *    the CLI.
 * 2. Calls the real `@mariozechner/pi-ai` `streamSimple` against the
 *    provider+model the user picked. The API key is taken from the
 *    corresponding environment variable (`ANTHROPIC_API_KEY`,
 *    `OPENAI_API_KEY`, `GOOGLE_API_KEY`). Missing key → hard error; no
 *    fallback, no retry.
 * 3. Serialises the single turn (user message + assistant reply + token
 *    ledger) into the JSONL shape documented in tests/eval/README.md.
 *
 * What this CLI does NOT do:
 *
 * - Multi-turn agent loops. Tool use / tool results are not yet wired in;
 *   the B5.1 live-replay tier is where that work belongs. Tonight's scope
 *   is a single-turn record.
 * - Fixture synthesis. If the provider call fails for any reason, the
 *   error is rethrown and no JSONL is written. `Let it crash`.
 * - Retrying, resuming, or merging with an existing fixture.
 * - Seeding assertions or semantic rubrics. The assertions block is written
 *   empty; the user fills it in by hand using the README contract.
 *
 * All failure modes surface as non-zero exits with a specific message —
 * the user should read the stderr line and fix the cause (missing env,
 * missing file, provider error), not the harness.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import {
  getModel,
  streamSimple,
  type AssistantMessage,
  type Context,
  type Provider,
  type UserMessage,
} from "@mariozechner/pi-ai";
import type {
  AssertionsBlock,
  AssistantTurn,
  FixtureMeta,
  TokenLedger,
  UserTurn,
} from "./types.js";

interface CliArgs {
  fixtureId: string;
  scenario: string;
  provider: string;
  modelId: string;
  systemPromptFile: string;
  userMessageFile: string;
  out: string;
}

function readArg(args: string[], flag: string, required: true): string;
function readArg(args: string[], flag: string, required: false): string | undefined;
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
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage());
    process.exit(0);
  }
  return {
    fixtureId: readArg(args, "--fixture-id", true),
    scenario: readArg(args, "--scenario", true),
    provider: readArg(args, "--provider", true),
    modelId: readArg(args, "--model", true),
    systemPromptFile: readArg(args, "--system-prompt-file", true),
    userMessageFile: readArg(args, "--user-message-file", true),
    out: readArg(args, "--output", true),
  };
}

function usage(): string {
  return [
    "pnpm eval:record — record a single-turn LLM fixture against a real provider",
    "",
    "Required flags:",
    "  --scenario <text>             Human description of what the scenario exercises",
    "  --fixture-id <kebab-case>     Stable identifier; used as filename stem",
    "  --provider <id>               anthropic | openai | google",
    "  --model <id>                  Provider-specific model id, e.g. claude-sonnet-4-5-20250929",
    "  --system-prompt-file <path>   File containing the system prompt",
    "  --user-message-file <path>    File containing the first user message",
    "  --output <path>               Destination JSONL path, e.g. tests/eval/fixtures/ceo-bootstrap-empty.jsonl",
    "",
    "Environment:",
    "  ANTHROPIC_API_KEY | OPENAI_API_KEY | GOOGLE_API_KEY — required for the chosen provider",
    "",
    "See tests/eval/README.md for an end-to-end walkthrough.",
    "",
  ].join("\n");
}

function resolvePiAgentCoreVersion(): string {
  const req = createRequire(import.meta.url);
  const pkg = req("@mariozechner/pi-agent-core/package.json") as { version?: unknown };
  if (typeof pkg.version !== "string") {
    throw new Error("record-fixture: could not resolve @mariozechner/pi-agent-core version");
  }
  return pkg.version;
}

interface ProviderSpec {
  id: Provider;
  envVar: string;
}

const PROVIDER_TABLE: Record<string, ProviderSpec> = {
  anthropic: { id: "anthropic", envVar: "ANTHROPIC_API_KEY" },
  openai: { id: "openai", envVar: "OPENAI_API_KEY" },
  google: { id: "google", envVar: "GOOGLE_API_KEY" },
};

function resolveProvider(rawProvider: string): ProviderSpec {
  const spec = PROVIDER_TABLE[rawProvider];
  if (!spec) {
    throw new Error(
      `record-fixture: unsupported provider "${rawProvider}". ` +
        `Supported: ${Object.keys(PROVIDER_TABLE).join(", ")}.`,
    );
  }
  return spec;
}

function requireApiKey(envVar: string): string {
  const key = process.env[envVar];
  if (!key || key.length === 0) {
    throw new Error(
      `record-fixture: missing ${envVar} in environment. Export it before re-running:\n` +
        `  export ${envVar}=...\n` +
        `  pnpm eval:record ...`,
    );
  }
  return key;
}

function buildMeta(args: CliArgs, systemPrompt: string): FixtureMeta {
  const hash = createHash("sha256").update(systemPrompt).digest("hex");
  return {
    type: "meta",
    fixtureId: args.fixtureId,
    piAgentCoreVersion: resolvePiAgentCoreVersion(),
    recordedAt: new Date().toISOString(),
    scenario: args.scenario,
    systemPromptHash: `sha256:${hash}`,
  };
}

function buildUserTurn(text: string): UserTurn {
  return {
    type: "turn",
    turnIndex: 0,
    role: "user",
    content: [{ type: "text", text }],
  };
}

function buildAssistantTurn(final: AssistantMessage): AssistantTurn {
  const tokenLedger: TokenLedger = {
    input: final.usage.input,
    cache_read: final.usage.cacheRead,
    cache_creation: final.usage.cacheWrite,
    output: final.usage.output,
  };
  return {
    type: "turn",
    turnIndex: 1,
    role: "assistant",
    content: final.content,
    tokenLedger,
  };
}

function buildEmptyAssertions(): AssertionsBlock {
  return { type: "assertions", assertions: [], semanticRubric: [] };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const providerSpec = resolveProvider(args.provider);
  const apiKey = requireApiKey(providerSpec.envVar);

  const [systemPrompt, userMessage] = await Promise.all([
    readFile(resolve(args.systemPromptFile), "utf8"),
    readFile(resolve(args.userMessageFile), "utf8"),
  ]);

  if (systemPrompt.trim().length === 0) {
    throw new Error(
      `record-fixture: ${args.systemPromptFile} is empty. A fixture must carry a real system prompt.`,
    );
  }
  if (userMessage.trim().length === 0) {
    throw new Error(
      `record-fixture: ${args.userMessageFile} is empty. A fixture must carry a real user message.`,
    );
  }

  const model = getModel(providerSpec.id as never, args.modelId as never);
  if (!model) {
    throw new Error(
      `record-fixture: unknown model "${args.modelId}" for provider "${providerSpec.id}". ` +
        `Consult @mariozechner/pi-ai's models registry for valid ids.`,
    );
  }

  const userMessagePayload: UserMessage = {
    role: "user",
    content: userMessage,
    timestamp: Date.now(),
  };

  const context: Context = {
    systemPrompt,
    messages: [userMessagePayload],
  };

  process.stderr.write(
    `record-fixture: calling ${providerSpec.id}/${args.modelId} (single turn, no tool use)…\n`,
  );

  const stream = streamSimple(model, context, { apiKey });
  const final = await stream.result();

  if (final.stopReason === "error" || final.stopReason === "aborted") {
    const detail = final.errorMessage ?? `provider returned stopReason=${final.stopReason}`;
    throw new Error(
      `record-fixture: provider call failed — ${detail}. No fixture written; fix the cause and re-run.`,
    );
  }

  const meta = buildMeta(args, systemPrompt);
  const userTurn = buildUserTurn(userMessage);
  const assistantTurn = buildAssistantTurn(final);
  const assertions = buildEmptyAssertions();

  const lines = [
    JSON.stringify(meta),
    JSON.stringify(userTurn),
    JSON.stringify(assistantTurn),
    JSON.stringify(assertions),
  ];
  const outPath = resolve(args.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${lines.join("\n")}\n`, "utf8");

  const usageSummary = `in=${final.usage.input} cacheRead=${final.usage.cacheRead} cacheWrite=${final.usage.cacheWrite} out=${final.usage.output}`;
  process.stdout.write(
    [
      `record-fixture: wrote fixture ${args.fixtureId} to ${outPath}`,
      `record-fixture: usage ${usageSummary} stopReason=${final.stopReason}`,
      `record-fixture: assertions block is empty — edit ${outPath} and add assertion plus semanticRubric entries`,
      `record-fixture: then verify with  pnpm test:eval --run`,
    ].join("\n") + "\n",
  );
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`record-fixture: ${detail}\n`);
  process.exit(1);
});
