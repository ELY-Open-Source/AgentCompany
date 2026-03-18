# AgentCompany Integrated Audit Matrix (2026-03-18)

## Scope

This audit covered:

- `PRD.md`
- Electron main / preload / renderer source under `src/main`, `src/preload`, `src/renderer`, `src/shared`
- Packaging and runtime config: `electron-builder.yml`, `electron.vite.config.ts`, `scripts/build-desktop.mjs`
- Existing validation assets under `tests/unit`, `tests/integration`, `tests/e2e`
- Runtime validation through a live Electron launch with real IPC, onboarding, org creation, approvals, and run orchestration

## Evidence Collected

Validation commands executed in this session:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm test:e2e`
- `pnpm electron-vite build`

Additional runtime scenarios executed against the built Electron app:

- full first-launch onboarding to desktop shell
- navigation sweep across desktop sections
- live hire request flow with `autoApproveHires = true`
- live hire request flow with `autoApproveHires = false`
- negative-path validation that legacy `saveAgent` creation and `pending_approval -> idle` status bypasses are rejected

## Current Architecture Reality

What already exists and is materially real:

- main / preload / renderer separation is implemented
- renderer uses typed preload APIs instead of raw Node access
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` are used for the main desktop shell
- orchestration worker runs in an Electron utility process
- SQLite-backed local-first state model exists
- connectors for `codex_local`, `claude_local`, `gemini_local`, `opencode_local`, `kimi_local` exist
- approvals, runs, costs, activity, automation, meetings, knowledge, documents, sprints, social, messages, workspaces, and onboarding all exist in code and UI

What is still structurally weak:

- several modules are still too large to be considered stable long-term coordination boundaries
- cross-feature side effects still live in a few orchestration-heavy modules instead of a smaller explicit event-policy layer
- some release/security/product rules exist in PRD and code, but not all are enforced uniformly in every write path

Largest modules by line count at audit time:

- `src/main/database.ts`: 3348
- `src/renderer/components/execution.tsx`: 1726
- `src/renderer/components/communication.tsx`: 1726
- `src/main/api-server.ts`: 1697
- `src/renderer/components/automation.tsx`: 1693
- `src/renderer/App.tsx`: 1606
- `src/main/prompt-builder.ts`: 1541

## PRD Matrix

### 1. Local Profile / Company

Status: implemented, with one policy caveat

Evidence:

- local profile bootstrap, backup/restore, company switching, settings persistence all exist
- onboarding successfully creates company, workspace, goal, initial run, and opens desktop shell

Remaining risk:

- company policy toggles are present, but some governance behavior is still distributed across UI, IPC, API, and automation rather than centralized in a single policy service

### 2. Connector Management

Status: implemented

Evidence:

- connector registry UI exists
- connector health service exists
- model listing and auth terminal support exist
- command/env binding handling exists

Remaining risk:

- connector execution policy is still sensitive to environment-based behavior and deserves a dedicated policy surface, not scattered guard clauses

### 3. Agent Registry / Org Structure

Status: implemented, previously inconsistent, partially hardened in this wave

Evidence:

- org chart, agent roster, hiring pipeline, manager/report relationships, and budget fields exist
- pending-approval lifecycle exists in data model and approval resolution logic

Critical finding fixed in this wave:

- renderer previously allowed direct agent creation from the Agents page, bypassing `hire_agent` approval and breaking synchronization between Hiring, Approvals, onboarding, and org history
- renderer also allowed direct status edits that could move a pending hire into an active state without an approval decision

Remediation added:

- dedicated `requestHire` IPC contract
- transactional `createHireRequest(...)` persistence path
- renderer Agent creation now submits hire requests instead of active agents
- IPC `saveAgent` now rejects new-agent creation and rejects direct pending-hire activation

Runtime proof:

- with `autoApproveHires = false`, a new hire lands in `pending_approval`
- direct `saveAgent` creation returns `AGENT_CREATION_REQUIRES_HIRE_REQUEST`
- direct status bypass returns `AGENT_APPROVAL_REQUIRED`
- formal approval transitions the same agent record to `idle`

### 4. Goals / Projects / Tasks

Status: implemented

Evidence:

- onboarding creates goal and project structure
- task creation, comments, assignment, review states, kanban/list views, and run linkage exist
- task status changes feed automation/orchestration paths

Remaining risk:

- feature is functionally present, but task + review + message + automation interactions are still distributed across large renderer and main modules

### 5. Run Orchestration / Session Continuity

Status: implemented, with scaling caveats

Evidence:

- run creation, queueing, worker dispatch, recovery, logs, cancellation, and run status events exist
- utility-process worker is used instead of running orchestration in the renderer
- integration tests cover autonomous chain and recovery cases

Remaining risk:

- orchestration and wake logic remain heavily centralized
- cross-feature triggers are correct at current scope, but scaling behavior and event fan-out still need a slimmer event-policy boundary

### 6. Approvals / Governance

Status: implemented, materially improved in this wave

Evidence:

- approvals UI, decision handling, related task linkage, and automation callbacks exist
- board-side approval decisions update state and trigger follow-up automations

Critical finding fixed in this wave:

- agent creation governance could be bypassed from the desktop UI and IPC write path

Remaining risk:

- other approval-governed domains, especially termination and production-deploy style flows, still deserve the same hard policy treatment across all entrypoints

### 7. Cost / Budget

Status: implemented

Evidence:

- budget fields, cost entries, cost dashboard, thresholds, and budget-related automation logic exist

Remaining risk:

- budgets are enforced operationally, but not all escalation policy is centralized; some cost behavior is still advisory rather than hard-stopping privileged actions

### 8. Activity / Audit / Logs

Status: implemented

Evidence:

- activity timeline exists
- many core mutations add activity entries
- run logs exist and are streamable into renderer console panels

Remaining risk:

- structured logging exists, but the audit trail is still assembled from multiple write sites instead of passing through a smaller domain-event backbone

### 9. Secrets / Config / Environment

Status: implemented, hardened in this wave

Evidence:

- Electron `safeStorage` is used where available
- encrypted fallback vault exists behind explicit env opt-in
- env binding resolution exists for connector runs

Security hardening added in this wave:

- `NODE_OPTIONS` was removed from the runtime environment allowlist so spawned agent runtimes do not inherit host-side Node injection flags by default

Remaining risk:

- preload API surface is still large, even if typed
- env policy should eventually be expressed as explicit runtime capability profiles per connector, not only a static allowlist

### 10. Workspace / Repo / Artifact Management

Status: implemented

Evidence:

- workspace registry, path selection, repo URL/ref fields, primary workspace logic, and lock metadata exist
- orchestration resolves workspace context into runtime env

Remaining risk:

- workspace locking and stale-lock cleanup exist, but deserve more explicit operator-facing conflict states in UI for complex multi-run contention

### 11. Notifications / State Awareness

Status: implemented

Evidence:

- desktop notifications exist
- tray/menu/window controls exist
- sidebar badges, inbox, and console surfacing exist

Remaining risk:

- notification strategy is present but not yet tuned as a full release-quality desktop attention model across macOS, Windows, and Linux

## Electron / Security / Release Audit

### Security Baseline

Status: mostly aligned

Confirmed:

- secure BrowserWindow defaults are in place
- renderer does not receive raw Node primitives
- preload uses typed IPC contract calls
- utility process is used for background orchestration work
- vault prefers OS-backed secret storage

New hardening applied:

- runtime env no longer forwards host `NODE_OPTIONS`
- pending-hire governance cannot be bypassed from renderer IPC

Still open:

- preload surface is broader than ideal for a production app of this size
- some domain rules are enforced in handlers rather than at a smaller dedicated policy layer

### Packaging / Release

Status: partially complete

Confirmed:

- `electron-builder.yml` targets macOS, Windows, Linux
- build script cleans `/build`, stages a non-mutating build version, and outputs into `/build/release`
- e2e and build use the current Electron/Vite packaging path correctly

Still open:

- this audit validated runtime on the current local platform only
- cross-platform runtime differences and signing/notarization behavior still need explicit validation evidence per target platform
- updater flow currently checks availability but does not yet provide a fully operator-visible download/install lifecycle

### Performance

Status: acceptable for current prototype depth, not yet release-optimized

Evidence:

- app launches and is usable in live runtime checks
- worker isolation prevents heavy agent runs from living in renderer

Remaining risk:

- renderer build currently produces an approximately `1.7 MB` main JS chunk, which is too large for a polished long-term desktop shell
- mega-components still make fine-grained performance work harder than it should be

## External Research Used

Primary references used for this audit:

- Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security
- Electron process model / utility process guidance: https://www.electronjs.org/docs/latest/tutorial/process-model
- Electron safe storage API: https://www.electronjs.org/docs/latest/api/safe-storage
- electron-builder auto-update guidance: https://www.electron.build/auto-update

These references were used to validate:

- secure BrowserWindow / preload expectations
- utility-process suitability for background work
- safe secret storage expectations
- updater/build configuration direction

## Remediation Implemented In This Wave

Files changed in this wave:

- `src/shared/contracts.ts`
- `src/preload/index.ts`
- `src/main/runtime-env.ts`
- `src/main/database.ts`
- `src/main/ipc-core-work-graph-handlers.ts`
- `src/renderer/components/organization.tsx`
- `src/renderer/App.tsx`

Concrete changes:

- added typed `requestHire` contract and preload API
- added transactional `createHireRequest(...)` database path
- rerouted renderer new-agent flow into hiring / approvals pipeline
- blocked direct renderer IPC creation of active agents
- blocked direct renderer status promotion of pending hires
- tightened runtime env inheritance by removing `NODE_OPTIONS`

## Remaining High-Value Follow-Ups

1. Split `App.tsx`, `database.ts`, `api-server.ts`, `automation-service.ts`, `communication.tsx`, and `execution.tsx` into smaller domain slices.
2. Pull wake / publish / automation side effects into an explicit domain-event policy layer instead of leaving them distributed in orchestration-heavy modules.
3. Shrink the renderer entry chunk with section-level lazy loading for heavyweight desktop panels.
4. Make updater lifecycle operator-visible beyond availability checks.
5. Validate runtime behavior on Windows and Linux rather than relying only on configured targets.
