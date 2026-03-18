# 2026-03-17 Runtime/Security Tranche

This tranche locks the first production-boundary fixes before larger module extraction.

## Scope

- tighten agent run-token authority in the local API server
- stop default connector execution from bypassing runtime permission/sandbox flags
- harden renderer IPC sender validation
- prevent secret bindings from overriding process-critical environment keys
- make browser-action cancellation affect real execution, not only database state

## Why this tranche comes first

These issues sit underneath every feature:

1. A compromised or overpowered run token could mutate company structure, approvals, and browser automation.
2. A globally bypassed connector runtime defeats approval and sandbox posture for all task runs.
3. Loose origin matching weakens the only boundary between renderer and privileged main-process handlers.
4. Fake cancellation creates visible state drift between the UI and external side effects.
5. Unrestricted env injection allows privilege escalation through runtime process configuration.

## Intended outcome

After this tranche:

- agent runs can no longer approve approvals or request arbitrary organization changes without role-based checks
- connector child processes run without implicit dangerous bypass flags
- only exact trusted renderer origins can invoke privileged IPC handlers
- reserved env keys are blocked from connector secret bindings
- cancelling a browser action cancels queued or active execution, not just the row in SQLite
