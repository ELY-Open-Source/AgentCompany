# Workspace Concurrency Model

## Summary

A run's workspace lock policy is inferred per task. `lockMode='none'`
is the default (pure cognitive work runs in parallel with no lock);
`lockMode='exclusive'` is the opt-in for runs that mutate the
filesystem. There is no shared lock mode and no silent fallback to
someone else's workspace.

All decisions live in one function: `resolveWorkspaceWithLockMode` in
`src/main/orchestration/resolve-workspace.ts`.

## Why the default is `none`

Before v52, every resolved workspace was held exclusively for the
duration of the run. In a multi-agent company the resolver's
four-step fallback chain (task → agent → project → any company
workspace) always converged onto the single company workspace row;
four agents trying to heartbeat simultaneously all claimed the same
exclusive lock and only one ever executed. The user experience
degraded from "parallel C-suite" to "one agent at a time" with no
error and no log line naming the cause.

The fix is not to pick a different fallback. It is to stop inferring
filesystem use from the shape of the graph and ask the task row:
**does this task actually touch the filesystem?** Strategy writing,
financial planning, document drafting, PM decisions — none of them
open a file or shell out — so by default they run fully in parallel
with `lockMode='none'`. Coding tasks opt in, and that opt-in is the
only path that takes a lock.

## The per-task signal: `tasks.requires_filesystem`

v52 added `tasks.requires_filesystem INTEGER NOT NULL DEFAULT 0`.
The column answers one question: "does this particular task mutate
the working tree?"

- `0` (default) → the task is cognitive. `lockMode='none'`.
- `1` → the task mutates files. `lockMode='exclusive'` on an
  explicit workspace.

Backfill at migration time is conservative — `1` is only set when we
have positive evidence: in-flight tasks already holding a lease, and
todo/backlog tasks whose assignee is in an engineering-flavoured
role. Everything else is `0`. New tasks default to `0` and the
creator explicitly flips to `1` when the task mutates files (a
follow-up CTO seed commit wires this into the default template).

## Coding-role inference (safety net)

A second signal fires when the resolving agent matches the coding
pattern:

```
role matches /cto|engineer|developer|devops|sre/i
  OR department === "engineering"
```

This is a transition-window safety net: in existing companies whose
task rows predate v52 (the backfill may not have caught every case),
a CTO heartbeat with no `requires_filesystem=1` task still correctly
takes an exclusive lock on its agent workspace. Once every task
creation path sets `requires_filesystem` explicitly the role inference
becomes a no-op.

## Decision table

```
task.workspaceId set          → exclusive on task.workspaceId
task.requiresFilesystem=1     → exclusive on agent.workspaceId
  OR agent role is coding       or project primary; throws if
                                 neither exists
everything else               → none / workspace=null
```

Explicit `task.workspaceId` always wins. This is the escape hatch for
"run this PR-review task on *that specific* branch workspace", and
it bypasses both the filesystem signal and the coding-role
inference.

## Why `company_fallback` was removed

The old fourth fallback step — return any workspace in the company
as the lock target — was the silent-corruption path. Four CTOs with
no workspace binding would all resolve to the same row; the first
claimed the lock; the other three reported `cancelled` with no
operator-visible error. There was no way to tell from the outside
whether the company had one workspace intentionally (and was
correctly serialising) or four workspaces mis-configured (and was
silently bottlenecking).

Post-v52: a filesystem-touching run with no legitimate workspace
binding throws `WorkspaceConfigurationError` at resolve time. The
caller decides recovery — `heartbeat.ts` releases the task lease
and returns `SKIPPED('workspace_unresolved')` so the task re-enters
the pool; `task-runner.ts` releases the lease and returns a
`WORKSPACE_UNRESOLVED` error so the UI can show the operator the
actual cause. Silent corruption is replaced by a visible
configuration error.

## Invariants enforced by the type

The return type makes the invariants impossible to violate in a
caller without a compile error:

```
lockMode = 'exclusive' ⇒ workspace is a live WorkspaceRecord
lockMode = 'none'      ⇒ workspace is null
```

Specifically, a caller that reads `resolution.workspace.id` with
`lockMode === 'exclusive'` is always safe; a caller that reads it
with `lockMode === 'none'` is a type error. `run-dispatch.ts` claims
a workspace lock only in the exclusive branch, which is why no lock
is ever acquired for a cognitive run.

## Failure modes and recovery

| Condition                                            | Behaviour                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| Cognitive task (no filesystem signal)                | `lockMode='none'`, run dispatches, no lock, full parallelism    |
| Coding task + agent workspace bound                  | `lockMode='exclusive'` on agent workspace, lock claimed         |
| Coding task + no agent workspace + project primary   | `lockMode='exclusive'` on project primary, lock claimed         |
| Coding task + no workspace anywhere                  | `WorkspaceConfigurationError`; heartbeat skips, lease released  |
| Two coding agents racing the same workspace          | First claims, second cancelled by dispatcher, retries next beat |

The last row is the pre-existing serialisation contract for truly
shared code repos — one writer at a time — and it continues to work
because the exclusive lock is still real. What changed is that
non-coding agents no longer participate in the race at all.
