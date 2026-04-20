# Contributing

This file documents the rules that are load-bearing for day-to-day work
in this repo. If you are using an AI agent, it must follow this file
too.

## Database access

All database calls go through domain modules:

```ts
db.tasks.saveTask(...)
db.agents.getAgent(...)
db.documentsMod.saveDocument(...)
```

**Adding a new pass-through on `AppDatabase` is not allowed.** The
pass-through layer existed historically, was removed in C1 (commits
`e352a69` → C1 part 2/3 → `ee1734e`), and is now guarded by an ESLint
rule that blocks regressions. Route every new call directly through
the owning sub-module.

If the ESLint rule fires on your change:

1. Read the sub-module list in `src/main/database/` to find the right
   owner for your method.
2. Either add the method to that sub-module (if it is new), or change
   the call site to use `db.<module>.<method>(...)` (if the method
   already exists there).
3. Do not silence the rule with an inline disable. If you think the
   rule is wrong for your case, open an issue — the rule has caught
   real regressions.

## C1 codemod

If a large surface of call sites ever needs to flip shape again (e.g.
a sub-module gets renamed, or a method moves between sub-modules), use
the codemod at `scripts/codemod/remove-appdatabase-passthrough.mjs` as
a starting point.

Usage:

```bash
# Dry run first:
node scripts/codemod/remove-appdatabase-passthrough.mjs --dry-run

# Then apply:
node scripts/codemod/remove-appdatabase-passthrough.mjs

# Scope to specific modules:
node scripts/codemod/remove-appdatabase-passthrough.mjs --modules=tasks,agents
```

The script's `METHOD_TO_MODULE` map and completeness evidence are
documented in `scripts/codemod/README.md`. The codemod stays in the
repo for future similar migrations; removing it would mean the next
person has to re-derive it from scratch.

## Reverting C1

C1 landed as three commits, and `ee1734e` bundled the final pass-through
removal with a vault-binding simplification. This means a clean revert
must be **sequential**, not independent:

```
git revert ee1734e   # revert 3/3 first (re-adds pass-throughs + vault back)
git revert <C1 part 2/3 sha>
git revert e352a69   # revert 1/3 last
```

Reverting out of order (e.g. only `e352a69`) leaves the ESLint guard
still active and the build will fail on the re-introduced pass-throughs.
If you only want to undo the vault changes without re-introducing
pass-throughs, do a hunk-scoped revert:

```
git revert -n ee1734e
git checkout --patch HEAD -- <vault-files>
git commit
```

## File-size ceiling

Files in `src/main/**` should stay under 500 LOC where practical. Two
files currently exceed the ceiling and carry TODO markers with a hard
review date (`M-followup by 2026-05-20`):

- `src/main/agent-runtime/artifact-projector.ts` (637 LOC)
- `src/main/agent-runtime/runtime-bridge.ts` (648 LOC)

If `2026-05-20` passes and these have not been decomposed, a follow-up
session MUST revisit them — either decompose, or justify the exception
in writing and update the TODO date.

## Error taxonomy (C6)

The error taxonomy migration is waved in `docs/proposals/C6.2-error-taxonomy-phase2.md`.
Each wave has a hard cap of 30 catch sites — C6 does not expand into an
unbounded sweep. If your change touches a catch block in `src/main/`
that has no `classifyUnknownError` call, add one using the existing
module pattern; do not leave bare `} catch {}` in new code.

## Before opening a PR

- `pnpm typecheck` clean
- `pnpm test:unit` green
- `pnpm lint` clean (this is where the pass-through guard lives)
- Keep the diff scoped — do not roll unrelated fixes into a single PR

If you use an agent, confirm it has read this file and `AGENTS.md`
before letting it commit.
