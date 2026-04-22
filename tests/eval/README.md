# B5 eval harness

This directory holds the LLM behavior eval tier for AgentCompany. It replays
recorded LLM traces (fixtures) through `pi-agent-core`'s Agent loop, feeds
recorded tool results back through replay tools, and checks structural
assertions against the replayed transcript: tool names, call counts, argument
shapes, message substrings, and turn caps. Semantic quality judgment belongs in
`docs/proposals/B5.1-llm-as-judge-followup.md`.

## File layout

| File | Role |
|---|---|
| `types.ts` | Wire types — fixtures, assertions, results. Reuses `@mariozechner/pi-ai` primitives. |
| `fixture-loader.ts` | JSONL → `FixtureFile`. Rejects malformed or missing meta/assertions blocks. |
| `replay-client.ts` | Swaps in for `pi-ai`'s `streamSimple`; replays recorded assistant turns. |
| `tool-loop-replay.ts` | Runs a fixture through `pi-agent-core` Agent with recorded tool-result executors. |
| `scenario-contract.ts` | Validates scenario prompt/user files, prompt hashes, and real prompt-builder SOP coverage. |
| `assertion-judge.ts` | Structural assertions over recorded trace. No semantic judgment. |
| `eval-runner.ts` | Parse fixture → Agent replay → judge assertions → produce `EvalResult`. |
| `record-fixture.ts` | CLI for writing fixture meta headers. Full record loop lands in B5.1. |
| `harness.test.ts` | vitest driver that walks `fixtures/` and asserts every fixture passes. |
| `fixtures/` | Recorded JSONL traces. Git-tracked. Not bundled into production (`electron-builder.yml` only ships `out/**`). |

## SOP coverage gate

`scenario-contract.ts` owns the prompt SOP coverage matrix. Each row renders a
real `buildTaskPrompt` context for one audience and lists the SOP headings that
must be present or absent for that scenario.

`harness.test.ts` reads every source file under
`src/main/prompt-builder/sops/*.en.md` and requires each `SOP-###` heading to be
claimed by at least one matrix scenario. Adding, deleting, or renaming a SOP
therefore changes `pnpm test:eval` directly.

## Running

```bash
# Agent-loop replay eval
pnpm test:eval
```

## Recording your first fixture

The recorder drives the **real** `@mariozechner/pi-ai` client against a
live provider. No mocks, no fallbacks. A fixture that exists was
produced by a real API call, end of story.

### Step 1 — export an API key

Pick the provider you want to record against and export the matching
variable:

```bash
export ANTHROPIC_API_KEY=sk-ant-…
# or
export OPENAI_API_KEY=sk-…
# or
export GOOGLE_API_KEY=…
```

The recorder **fails hard** if the variable is absent. This is
deliberate: silently skipping the call would produce a fixture that
documents the wrong thing.

### Step 2 — write the system prompt and user message to disk

The recorder reads both from files so you can version your scenarios
without pasting long prompts into shell args. Put them anywhere; the
conventional location is under `tests/eval/scenarios/<id>/`:

```bash
mkdir -p tests/eval/scenarios/ceo-bootstrap-empty
cat > tests/eval/scenarios/ceo-bootstrap-empty/system.txt <<'EOF'
You are the CEO of AgentCompany. Your team is empty. Call the `hire_agent`
tool to file the first three hires for the engineering, design, and
research departments. After all three, call `approve_ceo_strategy` once.
EOF

cat > tests/eval/scenarios/ceo-bootstrap-empty/user.txt <<'EOF'
Build me a team.
EOF
```

Empty files are rejected. A fixture with no real prompt captures no
real behaviour.

### Step 3 — record

```bash
pnpm eval:record \
  --scenario "Empty company, CEO bootstrap" \
  --fixture-id ceo-bootstrap-empty \
  --provider anthropic \
  --model claude-sonnet-4-5-20250929 \
  --system-prompt-file tests/eval/scenarios/ceo-bootstrap-empty/system.txt \
  --user-message-file tests/eval/scenarios/ceo-bootstrap-empty/user.txt \
  --output tests/eval/fixtures/ceo-bootstrap-empty.jsonl
```

On success you'll see the usage ledger printed to stdout and the JSONL
written at `--output`. The assertions block is written empty; the next
step is to fill it in.

### Step 4 — add assertions

Open the fixture you just wrote and replace the empty assertions block:

```diff
- {"type":"assertions","assertions":[]}
+ {"type":"assertions","assertions":[
+   {"kind":"tool_called","name":"hire_agent","min_count":3,"max_count":5},
+   {"kind":"message_contains_substring","role":"assistant","substring":"engineering"},
+   {"kind":"trace_max_turns","max":40}
+ ]}
```

Common assertion shapes:

```json
{"kind":"tool_called","name":"hire_agent","min_count":3}
{"kind":"no_tool_called","name":"delete_everything"}
{"kind":"message_contains_substring","role":"assistant","substring":"approve_ceo_strategy"}
{"kind":"tool_call_arg_matches","name":"hire_agent","arg_path":"department","matches_regex":"^(engineering|design|research)$"}
```

See `types.ts` for the exhaustive schema.

### Step 5 — verify

```bash
pnpm test:eval --run
```

A green run means the scenario prompt hash matches, the first user message
matches, the recorded transcript replays through the Agent loop, and every
assertion passes. A red run points at the broken contract: scenario drift,
tool-loop shape, replay failure, or assertion mismatch.

### Re-recording

Fixtures drift when the system prompt changes (the `systemPromptHash`
header surfaces that). To re-record, delete the old fixture and run the
recorder again. Do **not** hand-edit the `turn` records; that defeats
the point of recording against a real provider.

### Recorder boundary

The recorder captures the live provider response for the system prompt and
user message on disk. Tool-call replay happens during `pnpm test:eval`, where
recorded assistant turns run through the real Agent loop and recorded tool
results are returned by deterministic replay tools.

## Fixture JSONL format

Every fixture begins with a `meta` header, contains one `turn` per line in
ascending `turnIndex` order, and ends with an `assertions` block.

```jsonl
{"type":"meta","fixtureId":"ceo-team-building-empty","piAgentCoreVersion":"0.67.68","recordedAt":"2026-04-20T21:14:00.000Z","scenario":"Empty company, CEO bootstrap","systemPromptHash":"sha256:…"}
{"type":"turn","turnIndex":0,"role":"user","content":[{"type":"text","text":"build me a team"}]}
{"type":"turn","turnIndex":1,"role":"assistant","content":[{"type":"text","text":"Starting team build."},{"type":"toolCall","id":"call_1","name":"hire_agent","arguments":{"role":"engineer"}}],"tokenLedger":{"input":12345,"cache_read":11000,"cache_creation":345,"output":234}}
{"type":"turn","turnIndex":2,"role":"toolResult","toolUseId":"call_1","content":[{"type":"text","text":"hired agent-42"}]}
{"type":"assertions","assertions":[{"kind":"tool_called","name":"hire_agent","min_count":3,"max_count":5},{"kind":"trace_max_turns","max":40}]}
```

Field contracts:

- `meta.fixtureId` — stable kebab-case identifier used as the scenario name.
- `meta.piAgentCoreVersion` — the `@mariozechner/pi-agent-core` version
  used when the fixture was recorded. Drift against the installed version
  is allowed but future tooling will surface a warning.
- `meta.systemPromptHash` — sha256 of the system prompt text. Changes in
  this hash are the canonical signal that a fixture is stale.
- `turn.turnIndex` — strictly increasing from 0. Gaps or duplicates are
  hard errors.
- `turn.role = "assistant"` requires a `tokenLedger` in snake_case
  (`input`, `cache_read`, `cache_creation`, `output`). This maps 1:1 to
  pi-ai's `Usage.{input, cacheRead, cacheWrite, output}` — renamed to
  provider-neutral snake_case on disk.
- `assertions.assertions` — see `types.ts` for the complete schema.

## Assertion kinds

| Kind | Semantics |
|---|---|
| `tool_called` | Matches tool calls by `name`. Supports `min_count` (default 1), `max_count`, and `order` (0-based ordinal across all tool calls in the trace). |
| `no_tool_called` | Fails if any tool call with the given name appears. |
| `message_contains_substring` | Any `role`-matching message whose text content contains `substring` passes. |
| `tool_call_arg_matches` | At least one call to `name` has the dotted `arg_path` resolving to a string matching `matches_regex`. |
| `trace_max_turns` | Trace must have at most `max` turns. |

Anything that requires semantic judgment (tone, strategy, plan quality)
belongs in the LLM-as-judge tier. See
`docs/proposals/B5.1-llm-as-judge-followup.md`.

## Hard contracts

- Fixtures are recorded traces from live provider calls.
- `fixtures/` belongs in git and participates in `pnpm verify`.
- Every source SOP under `src/main/prompt-builder/sops/` belongs to at least
  one `EVAL_SCENARIO_MATRIX.requiredSops` entry.
- `scenarios/<fixtureId>/system.txt` must hash to
  `meta.systemPromptHash`.
- `scenarios/<fixtureId>/user.txt` must match the first user turn exactly.
- Structured assistant `toolCall` blocks require matching `toolResult` turns
  before the next assistant or user turn.
- Replay exhaustion, malformed fixtures, and scenario drift throw hard errors.
- Assertions stay structural; semantic judgment lives in the follow-up tier.

## Production bundle posture

`electron-builder.yml` ships only `out/**` and `package.json`. `tests/` —
including `tests/eval/fixtures/` — is never packaged into the shipped
`.asar`. Fixtures are dev-time / CI-time artifacts; they do not leak into
end-user installs.
