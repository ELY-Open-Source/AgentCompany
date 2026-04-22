# Eval fixtures

Every file in this directory is a **recorded trace** of a real AgentCompany
turn against a real LLM provider. Fixtures are recorded-truth, not
synthesized mock data — the distinction is what keeps the B5 harness on the
"fixture, not fallback" side of the roundtable line.

## File format

Each fixture is a `.jsonl` file with one JSON object per line:

1. First line: a `{ "type": "meta", ... }` record (see `FixtureMeta` in
   `../types.ts`).
2. Middle lines: one `{ "type": "turn", "turnIndex": N, ... }` record per
   conversation turn, in order. `turnIndex` is strictly increasing from `0`.
3. Last line: a `{ "type": "assertions", "assertions": [...] }` record with
   the expected behavior contract.

The loader rejects files that do not match this shape. No silent skipping.

## Recording workflow

```bash
pnpm eval:record -- \
  --fixture-id ceo-team-building-empty \
  --scenario "Empty company, CEO bootstrap" \
  --out tests/eval/fixtures/ceo-team-building-empty.jsonl \
  --system-prompt-preview "$(cat /tmp/current-system-prompt.txt)"
```

The current CLI records the provider assistant turn for a scenario prompt and
user message. `pnpm test:eval` runs the fixture through `pi-agent-core` with
recorded tool-result replay and validates the scenario prompt hash before
assertions run.

## Committing fixtures

Fixtures belong in git. They are small, deterministic, and the whole point
of the eval tier is to diff behavior against recorded truth. Do NOT add
`tests/eval/fixtures/` to `.gitignore`.

Fixtures are excluded from the electron-builder production bundle; see
`electron-builder.yml` (the `files` glob only picks `out/**`, so `tests/`
never enters the packaged `.asar`).
