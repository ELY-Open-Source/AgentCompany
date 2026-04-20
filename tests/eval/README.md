# B5 eval harness (minimal scaffold)

This directory holds the minimal LLM behavior eval tier for AgentCompany.
It replays recorded LLM traces (fixtures) and checks structural assertions
against them — tool names, call counts, argument shapes, message
substrings, and turn caps. It does *not* perform semantic quality judgment
yet; that tier is proposed in
`docs/proposals/B5.1-llm-as-judge-followup.md`.

## File layout

| File | Role |
|---|---|
| `types.ts` | Wire types — fixtures, assertions, results. Reuses `@mariozechner/pi-ai` primitives. |
| `fixture-loader.ts` | JSONL → `FixtureFile`. Rejects malformed or missing meta/assertions blocks. |
| `replay-client.ts` | Swaps in for `pi-ai`'s `streamSimple`; replays recorded assistant turns. Used by the live-replay tier in B5.1. |
| `assertion-judge.ts` | Structural assertions over recorded trace. No semantic judgment. |
| `eval-runner.ts` | Parse fixture → judge assertions → produce `EvalResult`. |
| `record-fixture.ts` | CLI for writing fixture meta headers. Full record loop lands in B5.1. |
| `harness.test.ts` | vitest driver that walks `fixtures/` and asserts every fixture passes. |
| `fixtures/` | Recorded JSONL traces. Git-tracked. Not bundled into production (`electron-builder.yml` only ships `out/**`). |

## Running

```bash
# Assertion-only eval (no fixtures needed; passes on empty fixture dir)
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

A green run means: given the recorded assistant turn, every assertion
you wrote passes. A red run means either the assertion is wrong or the
assistant did not produce the behaviour you expected — inspect the
fixture and decide which.

### Re-recording

Fixtures drift when the system prompt changes (the `systemPromptHash`
header surfaces that). To re-record, delete the old fixture and run the
recorder again. Do **not** hand-edit the `turn` records; that defeats
the point of recording against a real provider.

### What the recorder does NOT do

- It does not loop tool calls back to the provider. Today's recorder
  captures one turn: user message in, assistant reply out. Multi-turn
  with tool execution is B5.1's scope.
- It does not retry on provider errors. A 529 or a 5xx surfaces as a
  non-zero exit and nothing is written. Re-run manually if you think
  the failure was transient.
- It does not reach into AgentCompany's `src/main/` to import the
  worker's system prompt builder or tool catalogue. You bring your own
  prompt and message text on the CLI. Importing the worker would
  require the Electron runtime; the CLI is node-only on purpose.

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

## What this scaffold does NOT do tonight

- **No synthesized fixtures.** `fixtures/` ships empty. Fixtures arrive
  by running the recorder against a live provider.
- **No multi-turn tool-use recording.** The recorder captures one
  user→assistant turn. Multi-turn runs with real tool execution are
  B5.1's scope.
- **No live-replay.** `replay-client.ts` is ready to swap into the agent
  loop; wiring it into a real `pi-agent-core` Agent instance is also
  B5.1. Tonight the runner asserts against recorded turns directly.
- **No LLM-as-judge.** Assertions are structural only. Semantic judgment
  tier is proposed separately.
- **No logging / telemetry.** Results are returned from `runEval` as
  plain values; the vitest reporter is the only output surface.

Each omission is deliberate and documented. Nothing here silently degrades
to a placeholder — missing fixture = hard error, malformed fixture = hard
error, exhausted fixture = hard error.

## Production bundle posture

`electron-builder.yml` ships only `out/**` and `package.json`. `tests/` —
including `tests/eval/fixtures/` — is never packaged into the shipped
`.asar`. Fixtures are dev-time / CI-time artifacts; they do not leak into
end-user installs.
