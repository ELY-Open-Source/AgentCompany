# AgentCompany Full System Audit + Cross-Feature Remediation (2026-03-18)

## Scope and Method

- Repository scan scope: `src/main`, `src/preload`, `src/renderer`, `src/shared`, `tests`, `scripts`, build config.
- File inventory baseline: `173` tracked files (`rg --files | wc -l`).
- Validation gates executed after remediation:
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm typecheck:all`
  - `pnpm test:unit`
  - `pnpm test:integration`
  - `pnpm test:packages`
  - `pnpm test:e2e`
  - `AGENTCOMPANY_BUILD_VERSION=0.4.28 pnpm build`

## Mandatory Pipeline Mapping

### Phase 1 (ProjectManager): Scope + Milestones

- Current working milestone interpreted as: stabilize autonomous coordination + message workflow + desktop shell release readiness.
- Release artifact target confirmed: macOS arm64 zip output in `/build/release`.

### Phase 2 (ResearchAnalyst): Electron + Desktop Constraints

- Security baseline validated against Electron guidance:
  - renderer with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` in desktop shell and browser windows.
  - webview attach blocked; external navigation constrained in shell manager.
- Packaging/update baseline validated against `electron-builder.yml` and runtime build script.

### Phase 3 (TechnicalImplementationResearcher): Integration Model

- High-friction subsystem identified: message pipeline drift across API/IPC/automation/renderer.
- Root cause: duplicated validation + duplicated wake/emit logic + per-entrypoint special behavior.
- Strategy used: unify dispatch semantics in one `main` module and route all entrypoints through it.

### Phase 4 (EnterpriseArchitect): Boundary Enforcement

- Main/preload/renderer boundary retained.
- IPC contract hardened for message semantics (`direct`/`department`/`project` requirements).
- Connector execution defaults tightened to avoid implicit unsafe permission bypass.

### Phase 5-8 (Implementation + Verification)

Implemented and validated in this cycle (details below).

## Cross-Feature Coupling Audit (Before Fix)

### Critical coupling defects

1. Message contract drift between API / IPC / automation
   - Different validation, wake-up targeting, and event emission behavior.
2. Direct-message send path in renderer could lose recipient context outside reply mode.
3. Mark-read visibility check used bounded list (`limit=500`), causing false negatives at scale.
4. API message write path did not emit `new-message` event, unlike IPC/automation.
5. Connector execution safety policy inconsistent (`claude_local` bypass always on).
6. Console visibility control removed from header, breaking e2e contract and operator UX.

## Remediation Implemented

### 1) Unified message dispatch (single source of truth)

- Added: `src/main/message-dispatch.ts`
- Centralized:
  - input normalization
  - company/agent/project/parent validation
  - send + event emission
  - domain refresh publication
  - wake target resolution by channel

### 2) API, IPC, automation now use same dispatch behavior

- API send route now uses `dispatchAgentMessage` and shared schema parse.
- IPC send handler now uses `dispatchAgentMessage`.
- Automation actions (`send_message`, escalation, cross-department notify) now use `dispatchAgentMessage`.

### 3) IPC + API mark-read visibility correction

- Added `messageId` filter support to `db.listAgentMessages(...)`.
- Replaced broad visibility scans with targeted message visibility lookup (`limit: 1` + `messageId`).
- Removed over-restrictive direct-recipient-only mark-read branch to avoid false denial when sender marks visible thread entries.

### 4) API event parity restored

- `AgentApiServer` now receives and uses `emitEvent` callback.
- API-originated message writes now emit `new-message` event consistently with IPC/automation.

### 5) Connector security tightening

- `claude_local` execution config now ties `dangerouslySkipPermissions` to `AGENTCOMPANY_ALLOW_UNSAFE_CONNECTOR_BYPASS` (default false).
- `.env.example` documents this guard variable.

### 6) Renderer communication channel correctness

- DM channels now store participant sets and resolve recipient deterministically for composer send path.
- Compose modal enforces target requirements per channel (department/project require target; non-target channels clear target state).

### 7) Contract hardening

- `agentMessageInputSchema.superRefine(...)` enforces:
  - direct must provide `toAgentId`
  - department/project must provide `channelTargetId`
  - non-direct must not provide `toAgentId`
- Dispatch layer now enforces the same non-direct recipient prohibition, eliminating API/automation semantic mismatch.

### 8) Desktop UX/e2e compatibility restore

- Restored header `Show console / Hide console` control in `App.tsx` with stable ARIA/title semantics used by e2e.

## Adversarial Review (Opposite Model CLI)

- Ran `claude -p` in three lenses: `skeptic`, `architect`, `minimalist`.
- Output artifacts stored under `/tmp/adversarial-review-agentcompany-20260318-120225/`.
- Key accepted findings addressed in this cycle:
  - unsafe connector bypass inconsistency
  - API event parity gap
  - bounded mark-read visibility check correctness gap
- Remaining contested/medium findings (deferred) tracked in “Open Risks”.

## Open Risks / Remaining Work

1. `resolveMessageWakeTargets` is snapshot-based and can be heavy at larger org scale.
2. Incident/company channel wake fan-out can cause high wake volume without throttling.
3. Message attachment JSON is stored as raw string; no structural JSON validation yet.
4. Some renderer DM channel avatar semantics still depend on ambiguous channel-level `agentId` for two-party threads.
5. Update/notarization production credential flow still depends on release environment material availability.

## Verification Evidence

- Type safety: pass (`pnpm typecheck`, `pnpm typecheck:all`).
- Lint: pass (`pnpm lint`).
- Unit/integration/package tests: pass.
- E2E smoke: pass.
- Build packaging:
  - build folder cleaned by script
  - version used: `0.4.28`
  - artifact produced: `build/release/AgentCompany-0.4.28-arm64-mac.zip`

## External Research References

- Electron security checklist and architecture guidance:
  - https://www.electronjs.org/docs/latest/tutorial/security
- Preload and contextBridge guidance:
  - https://www.electronjs.org/docs/latest/tutorial/tutorial-preload
  - https://www.electronjs.org/docs/latest/api/context-bridge
- BrowserWindow/webPreferences hardening:
  - https://www.electronjs.org/docs/latest/api/browser-window
- Utility/background process model:
  - https://www.electronjs.org/docs/latest/api/utility-process
- Packaging and auto-update config:
  - https://www.electron.build/
  - https://www.electron.build/auto-update

## Changed Files (this remediation wave)

- `src/main/message-dispatch.ts` (new)
- `src/main/api-server.ts`
- `src/main/ipc-agent-coordination-handlers.ts`
- `src/main/database.ts`
- `src/main/automation-service.ts`
- `src/main/bootstrap-application.ts`
- `src/main/orchestrator/worker.ts`
- `src/shared/contracts.ts`
- `src/renderer/components/communication.tsx`
- `src/renderer/App.tsx`
- `.env.example`
- `package.json`
