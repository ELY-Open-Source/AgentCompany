# AgentCompany Cross-Feature Integrity Audit (2026-03-18)

## Scope

- `PRD.md`
- Electron runtime code under `src/main`, `src/preload`, `src/renderer`, `src/shared`
- Connector adapters under `packages/*`
- Build and packaging config: `package.json`, `electron-builder.yml`, `electron.vite.config.ts`, `scripts/build-desktop.mjs`
- Existing validation assets under `tests/unit`, `tests/integration`, `tests/e2e`
- Current Electron guidance and packaging guidance from official Electron and electron-builder documentation

## Pipeline Mapping

### Phase 1: ProjectManager

- Confirmed product target remains a local-first Electron desktop control plane, not a browser-shaped admin shell.
- Current milestone for this remediation wave: cross-feature integrity, autonomous execution gating, and release validation.

### Phase 2: ResearchAnalyst

- Checked current Electron guidance for:
  - context isolation and preload boundaries
  - sandbox and navigation restrictions
  - utility-process usage
  - packaging and update prerequisites

### Phase 3: TechnicalImplementationResearcher

- Traced how connector health, onboarding, hiring, orchestration, snapshot loading, and renderer forms interact.
- Focused on defects where one subsystem looked valid locally but corrupted another subsystem at runtime.

### Phase 4: EnterpriseArchitect

- Validated that the highest-severity current issues were policy drift and hidden truncation, not absence of feature surfaces.
- Chose to fix shared policy and shared data integrity before any cosmetic refactor.

## What Is Already Real

- Main / preload / renderer separation exists.
- Renderer does not depend on direct Node access.
- SQLite-backed local-first persistence exists.
- The app already contains real systems for onboarding, companies, agents, goals, projects, tasks, approvals, runs, costs, meetings, knowledge, documents, social accounts, automation, messaging, and packaging.
- Worker execution already runs outside the renderer.

## Highest-Severity Findings From This Audit

### 1. Global snapshot truncation polluted company-scoped behavior

Source:

- `src/main/database.ts`

Problem:

- `listSnapshot()` hard-capped `runs`, `cost_entries`, `agent_messages`, and `activity`.
- `listRendererSnapshot()` then filtered that already-truncated global result down to the current company.
- This allowed newer rows from other companies to displace current-company runs, messages, costs, and activity from the renderer snapshot.

Why this matters:

- Inbox severity, board unread counts, standup summaries, cost totals, run history, and communication history could silently diverge from real persisted state.
- The defect was cross-feature by construction because multiple views derived from the same truncated snapshot.

### 2. Connector policy drift allowed non-production runtimes onto the main execution path

Sources:

- `src/main/onboarding-service.ts`
- `src/main/orchestration-service.ts`
- `src/main/ipc-core-work-graph-handlers.ts`
- `src/main/api-server.ts`
- `src/renderer/components/CompanyOnboarding.tsx`
- `src/renderer/components/organization.tsx`
- `src/main/connectors.ts`
- `packages/adapter-kimi-local/src/server/test.ts`

Problem:

- Health checks marked generic or partial runtimes as `degraded`.
- Onboarding and orchestration still treated `degraded` as runnable.
- Hiring and agent editing could still bind agents to connectors that were not suitable for autonomous execution.
- `kimi_local` was explicitly documented as generic downgraded mode but was still able to enter product-critical flows.

Why this matters:

- The app could create or keep agents on runtimes that do not guarantee session resume or structured transcripts.
- That breaks the internal coordination model because messaging, run tracking, recovery, and auditability depend on a stable execution contract.

### 3. Policy enforcement was inconsistent across desktop UI, IPC, and local agent API

Problem:

- Even if the renderer restricted a path, API or IPC handlers could still write invalid connector assignments unless the same rule existed server-side.

Why this matters:

- The system would appear correct in one surface and remain invalid in another.
- That is an integrity failure, not a pure UI bug.

### 4. Architecture remains operationally real but still too concentrated

Largest modules remain heavy:

- `src/main/database.ts`
- `src/main/api-server.ts`
- `src/main/automation-service.ts`
- `src/main/prompt-builder.ts`
- `src/renderer/App.tsx`
- `src/renderer/components/communication.tsx`
- `src/renderer/components/execution.tsx`

Interpretation:

- The app is no longer a blank prototype, but some boundaries are still broader than a stable long-term production shape.
- This is a structural follow-up item, not a reason to leave integrity bugs unfixed.

## Remediation Implemented In This Wave

### Shared connector execution policy

- Added `src/shared/connector-policy.ts`.
- Defined a single execution-readiness rule used by main and renderer.
- Autonomous execution now requires:
  - connector status `ready`
  - session resume support
  - structured transcript support

### Snapshot integrity correction

- Kept protective limits on the global snapshot path used by broad system scans.
- Moved renderer and company analytics onto company-scoped SQL reads instead of filtering a global snapshot in memory.
- Added company + `created_at` indexes so the scoped history reads can stay predictable as data grows.

### Main-side enforcement

- Onboarding now rejects non-execution-ready connectors instead of silently falling back.
- Orchestration now blocks autonomous runs when the connector is not execution-ready.
- IPC agent save / hire request paths now reject non-execution-ready connectors.
- Local agent API hire requests now reject non-execution-ready connectors.

### Renderer alignment

- Onboarding only offers execution-ready connectors and explains why others are blocked.
- Agent creation only offers execution-ready connectors.
- Agent editing keeps blocked current connectors visible for repair, but prevents saving or waking until the agent is moved onto a ready connector.
- Dashboard connector health now uses the same execution-readiness rule as onboarding and orchestration.

## Verification Executed

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm test:e2e`
- `AGENTCOMPANY_BUILD_VERSION=0.4.39 pnpm build`

Build artifact produced in this session:

- `build/release/AgentCompany-0.4.39-arm64-mac.zip`

## Adversarial Review Outcome

- Reviewer CLI used: `claude -p`
- Lenses run: skeptic, architect, minimalist
- Accepted findings from that pass:
  - global LIMIT removal was the wrong fix; replaced with company-scoped SQL snapshot reads while keeping global caps
  - connector lookup failure needed structured `CONNECTOR_NOT_FOUND` handling instead of uncaught throws
  - dashboard readiness needed to use the same connector policy as onboarding and orchestration
- Rejected findings from that pass:
  - version bump concerns were procedural, not product risk
  - pure shared readiness helpers used by renderer were acceptable because they remain data-only and build-safe in the current architecture

## Residual Risks Still Present After This Wave

### 1. Preload surface is still broad

- It is typed, but still larger than ideal for a final hardened desktop app.

### 2. Several modules are still too large

- The codebase still needs deeper boundary extraction in `database`, `api-server`, `automation-service`, renderer shell composition, and some feature panels.

### 3. Cross-platform packaging has not yet been runtime-verified on all target OSes in this session

- Packaging config exists for macOS, Windows, and Linux.
- This session validated macOS packaging only.

### 4. Signing / updater production readiness still depends on release credentials and environment

- The code and config exist, but release trust still depends on actual signing/notarization/update infrastructure material.

## External References Used

- Electron security checklist:
  - https://www.electronjs.org/docs/latest/tutorial/security
- Electron context bridge:
  - https://www.electronjs.org/docs/latest/api/context-bridge
- Electron utility process:
  - https://www.electronjs.org/docs/latest/api/utility-process
- electron-builder auto-update:
  - https://www.electron.build/auto-update
- electron-builder macOS code signing:
  - https://www.electron.build/code-signing-mac
