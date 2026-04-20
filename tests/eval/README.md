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

# Record a stub fixture header (full recorder lands in B5.1)
pnpm eval:record -- \
  --fixture-id ceo-team-building-empty \
  --scenario "Empty company, CEO bootstrap" \
  --out tests/eval/fixtures/ceo-team-building-empty.jsonl
```

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

- **No synthesized fixtures.** `fixtures/` ships empty. The user records
  real traces by running the recorder against a live provider.
- **No live-replay.** `replay-client.ts` is ready to swap into the agent
  loop; wiring it into a real `pi-agent-core` Agent instance is the B5.1
  task. Tonight the runner asserts against recorded turns directly.
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
