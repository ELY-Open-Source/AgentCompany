# Proposal C4-followup: close out the remaining taste debt from C4

> Source: Roundtable 2026-04-20 session 6 cross-review (Jobs + Karpathy request_changes asks)
> Prerequisite: C4 landed (commits c91a233 through 0a35acf)
> Status: **CLOSED 2026-04-20** — all four items landed. See Completion notes at bottom.
> Owner: Linus + Karpathy
> Actual effort: ~1 working session
> Blocking dependencies: none — safe to pick up any time

## What this proposal closes out

C4 shipped the main meat — `hire_agent` + `file_approval` internal tools, the CEO initial-user-turn downgrade, the team-building SOP rewrite, and HTTP-hire deprecation. Cross-review surfaced four follow-up items that were out of scope for the C4 session but are small enough to land in a single follow-up pass. They are grouped here so a future session can execute them as one unit.

## Item 1: tighten `canRequestHire` scope to match the C4 narrative

**Problem** (Karpathy review, specific ask #2): `src/main/orchestration/internal-tool-selector.ts` attaches `hire_agent` to any agent where `canRequestHire` returns true. In `src/main/database/agent-permissions.ts:91-103`, `canRequestHire` is true whenever the role or title matches `vp|director|manager|lead|head|chief|cto|cmo|coo|cfo` or the agent sits in the HR department. The C4 commit narrative claims "CEO-only injection" — the code does not match.

**Fix**: introduce a separate `canFileCeoStrategy(agent)` predicate (true only when `reportsTo === null` AND role is CEO-equivalent). Attach `file_approval` only when that predicate holds. Leave `hire_agent` attached on `canRequestHire` but update the C4 commit narrative and team-building.en.md to say so explicitly. A manager hiring an IC is a legitimate flow — the original "CEO-only" framing was narrower than reality.

**Verification**: a fixture showing a manager (non-CEO) invoking `hire_agent` during a team-expansion trigger would pin the broader scope as intentional.

## Item 2: re-record `non-ceo-dm-reply` post-C4 for positive evidence

**Problem** (Karpathy review, specific ask #1): `tests/eval/fixtures/non-ceo-dm-reply.jsonl` was recorded at commit `302b8a0` before C4 part 3/5 (tool injection at `79edff5`) landed. The fixture therefore cannot discriminate between "non-CEO correctly does not receive `hire_agent` in its tool schema" and "the tool was never offered because part 3/5 had not merged yet." `manager-task-handoff` was re-recorded post-C4 already (see `c4-followup-manager-rerecord` commit in this proposal's implementation). `non-ceo-dm-reply` still needs the same treatment.

**Fix**: re-record `non-ceo-dm-reply` with the current main tree. Confirm the assistant response still covers `mark_read` and `/api/agent_message/send` calls without referencing `hire_agent` (VP Product with two IC reports has management authority → `canRequestHire` is true → the tool is technically attached, but the trigger is a peer DM so the tool should not be invoked).

**Verification**: `pnpm test:eval --run` stays green with existing assertions.

## Item 3: add a deprecation counter and `Deprecation:` header to legacy HTTP hire routes

**Problem** (Karpathy specific ask #3, Jobs specific ask #1): `routes-agents.ts` and `routes-approvals.ts` currently emit a single `log.warn("[deprecated][C4] ...")` line per call. That's enough for audit-by-grep, insufficient for asserting "usage has hit zero" before physical removal.

**Fix**:
1. Expose a counter via the existing telemetry module (if one exists; grep for `metrics.increment` in `src/main/`). Tick on every call.
2. Add RFC 8594 HTTP headers to the deprecated routes:
   - `Deprecation: true`
   - `Sunset: Wed, 20 May 2026 00:00:00 GMT` (or a date 30 days out from the follow-up commit)
   - `Link: <docs/proposals/C4-followup.md>; rel="deprecation"`
3. Document removal timeline: if the counter stays at zero for two weeks after this proposal lands, delete the route handlers physically.

## Item 4: negative assertion kind for the eval harness

**Problem** (Karpathy specific ask #4): the current `assertion-judge.ts` supports positive substring assertions (`message_contains_substring`) but no negation. Asserting "the IC fixture does NOT contain `hire_agent` in its tool list" is not expressible, so tool-schema regressions on the IC path are only caught implicitly.

**Fix**: add a new assertion kind in `tests/eval/assertion-judge.ts`:

```ts
type Assertion =
  | ... // existing kinds
  | { kind: "message_does_not_contain_substring"; role: "user" | "assistant"; substring: string };
```

Wire it through `assertion-judge.ts`'s `evaluate` switch. Update `tests/eval/harness.self-test.ts` (or wherever the harness self-tests live) to cover the new kind positively and negatively. Update C4-followup fixtures to use it where appropriate.

## Non-goals

- This proposal does NOT expose goal creation as an internal tool — that is C5-scope (`expose remaining CEO primitives as tools`) and depends on goal-lifecycle design.
- This proposal does NOT delete the legacy HTTP routes — they stay until the counter from item 3 stays at zero for two weeks.
- This proposal does NOT add an LLM-as-judge tier — that is B5.1-scope and gated on fixture count N ≥ 10.

## Completion criteria

This proposal closes when all four items land and:
- `pnpm typecheck` green
- `pnpm test:eval --run` green at ≥ 8/8
- `canFileCeoStrategy` predicate exists and is referenced by `internal-tool-selector.ts`
- `non-ceo-dm-reply` fixture's `recordedAt` is after `c91a233`
- Deprecation counter exists; counter value visible in telemetry; RFC 8594 headers on both legacy routes
- `message_does_not_contain_substring` assertion kind passes harness self-tests

## Completion notes (2026-04-20)

All four items landed in the same session as the proposal. Resolution:

| Item | Commit | Notes |
|---|---|---|
| #1 `canFileCeoStrategy` predicate | `f8f0874` | `file_approval` now gates on `role ∈ /^(CEO|chief executive officer)$/i && reportsTo === null`, orthogonal to `canRequestHire`. Manager with virtual superior no longer breaks scope. 4 unit cases in `tests/unit/agent-permissions-ceo-strategy.test.ts`. |
| #2 Re-record `non-ceo-dm-reply` | (this commit) | VP Product (manager with `canRequestHire=true` but `canFileCeoStrategy=false` after #1) re-recorded post-C4. Assistant hits `mark_read` + `/api/agent_message/send` + keeps `m_77` in scope; does not invoke `hire_agent` or `file_approval` — positive evidence that the F3 split correctly excludes file_approval from non-CEO managers. |
| #3 RFC 8594 headers + counter | `f99e6c4` | New `src/main/api-server/deprecation-counter.ts` (Map-backed, sync, throws on empty label). Both legacy routes emit `Deprecation: true` + `Sunset: Tue, 20 May 2026 00:00:00 GMT` + `Link: </docs/proposals/C4-followup.md>; rel="deprecation"`. Counter ticks on each call. 4 unit cases in `tests/unit/deprecation-counter.test.ts`. Removal gate: counter stays at zero for two weeks, then physically delete both route branches. |
| #4 `message_does_not_contain_substring` assertion | `9d3763d` | New assertion kind added to `tests/eval/types.ts`, `tests/eval/assertion-judge.ts`. Two harness self-tests added. `ceo-bootstrap-empty` fixture now pins `node -e` and `/api/companies` as negative substrings — any future CEO bootstrap that reintroduces the HTTP-path antipattern fails `pnpm test:eval`. Proxy cleanup also pins `hire_agent`/`file_approval` as negative on `non-ceo-dm-reply`. |

**Companion cleanup** (same session, docs-adjacent):

| Concern | Commit | Notes |
|---|---|---|
| RPC method list duplicated between zod schema and TS union (the category that produced the C4→C5 hotfix `9d9f003`) | `d4ec922` | Extracted `workerRpcMethodSchema = z.enum([...])` in `worker/entry/types.ts` as single source of truth; `runtime-bridge.ts` now imports `WorkerRpcMethod = z.infer<typeof workerRpcMethodSchema>`. Added `default: { const _exhaustive: never = ... }` to the handler switch so a widened enum without a matching case becomes a TypeScript error rather than a runtime ZodError. |

Final verification: `pnpm typecheck` green, `pnpm test:unit` 537/537, `pnpm test:eval` 10/10, working tree clean post-`non-ceo-dm-reply` re-record.
