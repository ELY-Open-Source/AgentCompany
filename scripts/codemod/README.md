# scripts/codemod/

One-shot and reusable codemods for mechanical refactors. Kept in the repo
so the next person doing a similar migration has a working starting
point instead of re-deriving it from scratch.

## remove-appdatabase-passthrough.mjs

Rewrites `db.<method>(...)` → `db.<module>.<method>(...)` for every
pass-through method that used to live on `AppDatabase` / `AppDatabaseBase`
and now lives on a sub-module field.

### Usage

```bash
# Full rewrite across src/**, tests/**:
node scripts/codemod/remove-appdatabase-passthrough.mjs

# Dry run (print what would change, don't write):
node scripts/codemod/remove-appdatabase-passthrough.mjs --dry-run

# Restrict to one or more modules:
node scripts/codemod/remove-appdatabase-passthrough.mjs --modules=tasks,agents
```

The script walks `git ls-files 'src/**/*.ts' 'src/**/*.tsx' 'tests/**/*.ts'`
(so it respects `.gitignore`), excludes the three files that define the
pass-throughs themselves (`src/main/database.ts`,
`src/main/database-base.ts`, `src/main/database/**`), and applies the
regex `(^|[^\w.])((?:[\w$]+\.)*)db\.(<method>)\(` → `$1$2db.<module>.<method>(`.

### C1 migration evidence (coverage proof)

The `METHOD_TO_MODULE` map in the script was derived mechanically from
two source-of-truth files as they existed at the start of C1:

1. `src/main/database.ts` (pre-C1) — defined pass-through methods on
   `AppDatabase` that delegated to domain modules.
2. `src/main/database-base.ts` (pre-C1) — defined pass-through methods
   on the base class that delegated to sub-module fields.

Every pass-through method name from those two files was copied into the
map with its owning sub-module field name. Two composite methods
(`createHireRequest`, `rollbackConfigRevision`) are intentionally left
unmapped because they span multiple modules and live on `AppDatabase`
itself; rewriting them would break caller semantics.

The completeness of the map is proven by two independent signals, not
by inspection alone:

- **Typecheck after C1 part 3/3** (commit `ee1734e`): `pnpm typecheck`
  is clean. If the map had missed any pass-through, call sites would
  still read `db.<method>(...)` against a deleted method, and the
  TypeScript compiler would surface it as `Property '<method>' does
  not exist on type 'AppDatabase'`. Typecheck passing = no orphaned
  call sites.
- **Test suite green after C1 part 3/3**: 524 tests pass. If the
  codemod had silently mis-mapped a method (e.g. routed `saveGoal` to
  `documentsMod` instead of `entityCrud`), the runtime would throw
  `TypeError: db.documentsMod.saveGoal is not a function` on the
  exercising test. All 524 tests green = map entries are semantically
  correct, not just syntactically in scope.

Taken together, typecheck-clean + 524 tests green = the map is
complete and correct across every live call site at the time of C1.

### When to use this script in the future

If a future refactor re-introduces a pass-through on `AppDatabase` for
temporary back-compat, and you want to remove it again, you have two
options:

1. Add the method to `METHOD_TO_MODULE` in this script and run it.
2. If the new pass-through follows a different shape (e.g. a method
   that moved to a different module entirely), copy this script as a
   template and adjust the map. The regex structure is reusable.

The ESLint rule in `eslint.config.mjs` blocks new pass-throughs from
landing in the first place. See `CONTRIBUTING.md` at the repo root for
the rule and the guidance on when to invoke the codemod.

### C1 commit recipe and revert ordering

C1 landed as three commits. The final one (`ee1734e`) did two things in
the same commit — removed the remaining pass-throughs AND simplified the
vault binding layer. In retrospect the vault simplification should have
been a separate fourth commit so each concern could revert independently;
in practice the commits are already published, so the recipe below
records the actual state.

Commits (oldest first):

1. `e352a69` — codemod-driven rewrite of `tasks` + `agents` pass-throughs
2. (C1 part 2/3) — rewrite of remaining domain-module pass-throughs
3. `ee1734e` — remove final pass-throughs + add ESLint guard + simplify
   vault binding

**Sequential revert** (not independent): to unwind C1 cleanly you revert
in reverse order: 3 → 2 → 1. Reverting commit 2 or 1 without first
reverting 3 will leave the ESLint guard still active, which will then
fail on the re-introduced pass-throughs. The "net simplification" part
of `ee1734e` that touched the vault layer comes along for the ride; it
does not have its own revert handle.

If that bundling is ever a problem, the fix is not to rewrite history
(already published) but to issue a targeted revert of only the vault
hunks of `ee1734e` via `git revert -n ee1734e && git checkout --patch
HEAD -- <vault-files>`.
