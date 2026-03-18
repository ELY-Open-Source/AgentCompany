# 2026-03-17 Audit And Rebuild Plan

## Execution Order

This document is the Phase 1-4 artifact required by `AGENTS.md`.

1. ProjectManager: read the full PRD and define milestone gates.
2. ResearchAnalyst: verify Electron runtime, security, packaging, updater, and OS constraints.
3. TechnicalImplementationResearcher: freeze main/preload/renderer/storage/runtime boundaries.
4. EnterpriseArchitect: validate dependency direction, module seams, IPC contracts, and naming rules.

Implementation work starts only after the decisions below are recorded.

## Scope

The audit covers:

- PRD alignment
- Electron main / preload / renderer boundaries
- IPC contracts, sender validation, and company scoping
- connector runtime execution, orchestration, and background work
- local persistence, backup / restore, workspace locking, and crash recovery
- renderer information architecture, onboarding, and desktop UX
- packaging, updater, release, and verification posture
- adapter package quality and test coverage

## Baseline Evidence

### Repository state

- The working tree is already in a large, incomplete refactor state.
- The repo is no longer a prototype shell; it already contains a local data model, automation engine, workflow engine, browser automation surface, and an Electron shell.
- The implementation breadth is now large enough that coherence, not feature count, is the main problem.

### Verification results on 2026-03-17

- `pnpm typecheck`: pass
- `pnpm test:unit`: pass
- `pnpm test:integration`: pass
- `pnpm test:packages`: pass
- `pnpm test:e2e`: pass
- `pnpm build:verify`: pass
- `pnpm build:dir`: pass, producing `build/release/AgentCompany-0.4.26-arm64-mac.zip`
- `pnpm lint`: fail

### Current build posture

- Main bundle: `out/main/index.js` about `592 kB`
- Preload bundle: `out/preload/index.js` about `151 kB`
- Renderer bundle: `out/renderer/assets/index-*.js` about `1.69 MB`
- Packaging currently succeeds only on the host platform tested locally.

## Research Notes

The following external references were re-checked during this audit:

- Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security
- BrowserWindow API and platform notices: https://www.electronjs.org/docs/latest/api/browser-window
- Utility process API: https://www.electronjs.org/docs/latest/api/utility-process
- safeStorage API: https://www.electronjs.org/docs/latest/api/safe-storage
- Electron fuses: https://www.electronjs.org/docs/latest/tutorial/fuses
- electron-builder auto-update guide: https://www.electron.build/auto-update
- electron-builder publish guide: https://www.electron.build/publish

These references matter because the PRD explicitly requires secure preload exposure, custom protocol usage, sandboxing, OS-backed secret storage, release signing, and update integrity.

## Current State Summary

The application already has the following real subsystems:

- Electron shell with `contextIsolation`, `nodeIntegration: false`, `sandbox: true`, and a custom `app://` protocol
- local `DatabaseSync` SQLite store with WAL mode
- local API server for agent-driven actions
- utility-process worker for connector execution
- run orchestration, automation rules, workflow pipelines, messages, approvals, documents, meetings, sprints, and browser actions

The main issue is not “missing a single feature”.

The issue is that the system surface is broader than the stability and architecture boundaries that currently support it.

## Findings

### High severity

1. Main-process data access is concentrated in a single synchronous repository that is too large to remain reliable.
   - Evidence: `src/main/database.ts` is `3292` lines and owns schema setup, migrations, snapshots, orchestration state, cost accounting, approvals, messaging, workflow persistence, backup/restore, workspace locking, and dashboard aggregation.
   - Impact:
     - blocks maintainability
     - encourages cross-domain coupling
     - increases renderer-visible latency because many IPC calls read the same monolith

2. The renderer shell is still a god component and does not match the desktop-native operating model in the PRD.
   - Evidence: `src/renderer/App.tsx` is `1520` lines and owns navigation, data loading, company switching, command palette, modal orchestration, run log buffering, and page composition for every domain.
   - Impact:
     - feature interaction is hard to reason about
     - state ownership is blurred
     - operator workflows such as run monitoring are buried behind a console drawer instead of having first-class surfaces

3. The verification gate defined by the project itself is currently broken because lint does not run.
   - Evidence: `pnpm lint` fails with `ENOENT ... electron.vite.config.<timestamp>.mjs`.
   - Impact:
     - the release checklist in `AGENTS.md` is not met
     - CI or local quality enforcement is unreliable

4. Update and release readiness are not production-grade.
   - Evidence:
     - `electron-builder.yml` still defaults to a generic placeholder publish URL
     - `src/main/updater-service.ts` only checks availability; it does not implement a complete download/apply flow or pre-update backup
     - local mac packaging falls back to ad-hoc signing and skips notarization
   - Impact:
     - no shippable trust chain for public release
     - updater behavior is not aligned with PRD requirements

5. Automatic internal coordination is still mostly emergent behavior from prompts and heuristics, not a hardened orchestration contract.
   - Evidence:
     - `src/main/prompt-builder.ts` contains the majority of “real company behavior” instructions
     - `src/main/automation-service.ts` uses rule-triggered wakeups and message dispatch to simulate organization flow
     - no dedicated coordination state model exists for “conversation pending response”, “delegation awaiting acceptance”, or “review SLA breached”
   - Impact:
     - the system can appear intelligent in happy paths while remaining hard to debug in stalled paths
     - message flow, approvals, and delegation are not deterministic enough for a production control plane

### Medium severity

1. Snapshot loading is coarse-grained and expensive.
   - Evidence:
     - `db.listSnapshot()` reads nearly every table every time
     - `db.listRendererSnapshot()` still calls `listSnapshot()` first and only then filters by company
     - `App.refresh()` reloads the entire current company snapshot on most domain events
   - Impact:
     - unnecessary main-process work
     - unnecessary renderer re-renders
     - future scale problems once run/message/activity volume increases

2. Run log access is full-file based, not incremental.
   - Evidence:
     - `src/main/database.ts#readRunLog` returns the entire log file
     - renderer keeps in-memory log buffers in `App.tsx`
   - PRD mismatch:
     - PRD requires offset-based incremental log reading
   - Impact:
     - degraded performance on large logs
     - poor long-running run observability

3. The preload bridge is typed but too broad for the current architecture maturity.
   - Evidence: `src/preload/index.ts` exposes dozens of direct CRUD and orchestration methods.
   - Impact:
     - large privileged surface area
     - difficult contract governance
     - weak module boundaries between renderer and domain actions

4. Workflow and automation configuration crosses boundaries as opaque JSON strings.
   - Evidence:
     - `conditionsJson`, `actionConfigJson`, `stepsJson`, `triggerConfigJson`, `metadataJson`, `attachmentsJson` are passed across IPC and persistence as raw strings
   - Impact:
     - weak compile-time guarantees
     - more runtime parsing failures
     - harder migration and refactoring path

5. Onboarding still optimizes for spectacle more than operator clarity.
   - Evidence:
     - `src/renderer/components/CompanyOnboarding.tsx` strongly promises “autonomous company” behavior
     - connector choice and capability differences are not explicit enough
     - initial run review is not operator-first
   - Impact:
     - weak first-use trust
     - harder diagnosis when the selected connector is degraded or capability-limited

6. Browser/social automation is fragile and outside the core PRD center of gravity.
   - Evidence:
     - `src/main/browser-manager.ts` relies on direct DOM selectors, timed delays, and third-party site structure
   - Impact:
     - brittle surface
     - expands support burden
     - competes with higher-priority core orchestration work

7. The app supports many domains, but there is no dedicated Runs page.
   - Evidence:
     - run monitoring exists only through dashboard widgets and the bottom console drawer
   - PRD mismatch:
     - PRD requires live runs and log console as first-class operating surfaces

### Low severity

1. Renderer design language is coherent but still too web-dashboard-like for a desktop control plane.
   - Evidence:
     - system font stack in `src/renderer/styles.css`
     - single-column content area on many dense surfaces
     - heavy modal use for editing

2. Package-level runtime verification is narrow.
   - Evidence:
     - `test:packages` covers only `adapter-opencode-local` and `adapter-kimi-local`
     - `codex`, `claude`, and `gemini` packages do not have equivalent package test commands here

## Detailed Gap List By Domain

### Main / preload / IPC

- Sender validation exists and the custom protocol is correct, which is a good baseline.
- Contracts are typed, but not versioned and not yet narrowed by capability groups.
- `ipc-core-common.ts` and `ipc-domain-common.ts` still use `any`-heavy dependency wiring.
- The privileged bridge still mirrors domain CRUD too directly instead of exposing operator use-cases.

### Data / orchestration

- Workspace lock handling exists, but it is still embedded inside the database class.
- Queued-run recovery exists, but recovery semantics are still best-effort.
- Workflow execution is inline, stateful, and sync-heavy in the main process service layer.
- Aggregation views such as inbox, standup, and metrics are built inside the same DB class.

### Connectors

- Codex / Claude / Gemini / OpenCode have deeper execution paths than Kimi.
- Kimi remains generic CLI mode with explicit capability downgrade.
- Connector health checks use command probes and status translation, but operator feedback is still too shallow.
- Connector discovery and operator selection are still secondary in first-launch UX.

### Renderer

- The UI covers a large domain surface, but the operating hierarchy is inverted:
  - overview first
  - CRUD pages second
  - runs/logs/workspaces hidden as secondary tools
- The app does not yet “scream” workspace, run, and coordination as the primary desktop tasks.

### Testing / release

- Current automated coverage is better than zero, but still not close to the PRD completion criteria.
- E2E currently proves only first-launch onboarding and console toggle.
- No E2E covers:
  - task run lifecycle
  - approval resolution
  - message routing
  - workflow execution
  - connector health state changes
  - backup/restore
  - workspace locking / recovery
- Release docs do not yet define signed beta, RC, and production lanes.

## Rebuild Direction

### Tranche A: operator shell and observability

- add first-class Runs navigation and run triage workflow
- move run logs to chunked readers instead of whole-file loads
- make onboarding explicitly choose connector and workspace intent
- fix lint so the repo’s minimum quality gate works again

### Tranche B: boundary extraction

- split `AppDatabase` into read models, command repositories, and orchestration state store
- reduce preload surface to bounded capability groups
- split renderer shell from feature pages and detail inspectors

### Tranche C: release hardening

- define real update lanes and signing rules
- add updater backup/install flow
- document mac notarization, Windows signing, Linux packaging behavior
- flip relevant Electron fuses during packaging

## Milestone Gates

### Architecture Freeze

- audit findings accepted
- platform target confirmed
- process boundaries frozen
- core run / workspace / connector model frozen

### Interactive Prototype

- onboarding, connectors, agents, tasks, runs, console, workspaces all coherent

### Internal Alpha

- connector lifecycle, approvals, message routing, and crash recovery usable end-to-end

### Cross-Platform Validation

- macOS, Windows, Linux behavior documented and smoke-validated

### Signed Beta Build

- signing path defined
- updater feed real
- rollback / backup strategy documented

### Release Candidate

- lint, typecheck, unit, integration, E2E, build, and packaging gates all green

### Production Readiness

- security audit complete
- no placeholder release config remains
- operator workflows are deterministic and observable

## Next Implementation Slice

The next code tranche will target:

1. repair the lint gate
2. add first-class Runs navigation and incremental log loading
3. make onboarding force an explicit connector choice
4. keep build packaging green while making these changes
