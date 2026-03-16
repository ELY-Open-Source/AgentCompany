# Phase 1: Current Paperclip Audit

## Audit Boundary

This audit compares the current Paperclip repository against the target state defined in `PRD.md`: a secure Electron desktop application with strict `main` / `preload` / `renderer` separation, local-first orchestration, packaging, and OS-integrated workflows.

## Severity 0: Blocking Architectural Mismatch

### 1. No Electron process model exists

- Current repo contains no `BrowserWindow`, `preload`, `contextBridge`, `ipcMain`, `ipcRenderer`, `utilityProcess`, or packaging configuration.
- Evidence:
  - root search for Electron APIs returns no application implementation
  - [server/src/app.ts](/Users/zacharyzhang/Documents/Github/paperclip/server/src/app.ts)
  - [ui/src/App.tsx](/Users/zacharyzhang/Documents/Github/paperclip/ui/src/App.tsx)

Impact:

- There is no privileged boundary for filesystem, keychain, window lifecycle, native dialogs, menus, notifications, updater, or desktop protocol handling.
- The current product cannot be hardened into a desktop app by shell-wrapping the existing UI.

### 2. Orchestration is server-centric, not desktop-local

- Heartbeat execution, run tracking, workspace realization, and activity propagation live in the server process.
- Evidence:
  - [server/src/services/heartbeat.ts](/Users/zacharyzhang/Documents/Github/paperclip/server/src/services/heartbeat.ts)
  - [server/src/services/workspace-runtime.ts](/Users/zacharyzhang/Documents/Github/paperclip/server/src/services/workspace-runtime.ts)

Impact:

- The current implementation assumes a long-lived backend service instead of a desktop-owned local orchestration core.
- Crash semantics, app restart recovery, and foreground/background coordination are not modeled as desktop concerns.

### 3. The product shell is a routed web board, not a desktop console

- The top-level UI is route-driven, page-centric, and optimized for browser navigation rather than split-pane desktop operations.
- Evidence:
  - [ui/src/App.tsx](/Users/zacharyzhang/Documents/Github/paperclip/ui/src/App.tsx)
  - [ui/src/components/Layout.tsx](/Users/zacharyzhang/Documents/Github/paperclip/ui/src/components/Layout.tsx)

Impact:

- No desktop-native command surfaces for file dialogs, tray, menu actions, run console docking, workspace reveal, or keyboard-first operations.
- Core runtime objects such as connector health, workspace locks, session continuity, and log streams are not first-order interaction primitives.

## Severity 1: Major Product And UX Gaps

### 4. Onboarding is web-form oriented and does not establish a desktop local profile

- Existing onboarding creates company, CEO, and task records through API calls, but it does not create a local profile boundary, filesystem roots, workspace permissions, or connector health setup.
- Evidence:
  - [ui/src/components/OnboardingWizard.tsx](/Users/zacharyzhang/Documents/Github/paperclip/ui/src/components/OnboardingWizard.tsx)

Impact:

- First launch does not establish the desktop objects required by the PRD: local profile, workspace selection, connector detection, secret storage, and first-run orchestration.

### 5. Connector differences are hidden inside adapter packages instead of surfaced as product-level capability states

- Adapters exist, but the UI treats them mainly as form configuration.
- Evidence:
  - [server/src/adapters/registry.ts](/Users/zacharyzhang/Documents/Github/paperclip/server/src/adapters/registry.ts)
  - [ui/src/adapters/index.ts](/Users/zacharyzhang/Documents/Github/paperclip/ui/src/adapters/index.ts)

Impact:

- Users cannot reason about installation status, auth status, session resume support, structured transcript support, graceful cancel support, or unattributed cost behavior at the product level.

### 6. Workspace and repo context are present in backend logic but weak in the product hierarchy

- Workspace realization and worktree logic already exist, but they are not promoted to a central desktop experience.
- Evidence:
  - [server/src/services/workspace-runtime.ts](/Users/zacharyzhang/Documents/Github/paperclip/server/src/services/workspace-runtime.ts)
  - [doc/DEVELOPING.md](/Users/zacharyzhang/Documents/Github/paperclip/doc/DEVELOPING.md)

Impact:

- The codebase contains useful execution semantics, but the current UI still behaves like a CRUD admin console with runtime details buried behind secondary screens.

### 7. Run console and diagnostics are not treated as a persistent operational surface

- Logs and transcript UX exist, but not as a docked desktop utility layer with search, filtering, and background status awareness.
- Evidence:
  - [ui/src/components/transcript/RunTranscriptView.tsx](/Users/zacharyzhang/Documents/Github/paperclip/ui/src/components/transcript/RunTranscriptView.tsx)
  - [ui/src/pages/RunTranscriptUxLab.tsx](/Users/zacharyzhang/Documents/Github/paperclip/ui/src/pages/RunTranscriptUxLab.tsx)

Impact:

- Long-running desktop workflows need a utility drawer, live fan-out events, failure escalation, and state restoration, which the current web UX does not provide.

## Severity 2: Security And Desktop-Readiness Gaps

### 8. No preload boundary means there is no audited API surface for privileged actions

Impact:

- Desktop actions such as open folder, reveal artifact, backup profile, launch connector, store secret, or trigger updater would currently have no typed, validated boundary.

### 9. Secret handling is designed for server deployment, not OS keychain-first desktop storage

- Current repo includes secret versioning and local encrypted storage semantics.
- Evidence:
  - [server/src/services/secrets.ts](/Users/zacharyzhang/Documents/Github/paperclip/server/src/services/secrets.ts)
  - [doc/DATABASE.md](/Users/zacharyzhang/Documents/Github/paperclip/doc/DATABASE.md)

Impact:

- The PRD requires OS-backed secure storage first. The current implementation does not model Electron `safeStorage`, keychain backend selection, or desktop fallback behavior.

### 10. Packaging, signing, and updater flows do not exist

Impact:

- There is no release artifact model for DMG/NSIS/AppImage, no signing config, no update metadata flow, and no environment gates for release versus dev behavior.

### 11. IPC sender validation, CSP, and custom protocol concerns are absent because there is no desktop surface yet

Impact:

- These are not bugs in the current web app, but they are missing mandatory controls for the target architecture.

## Severity 3: Maintainability Risks When Porting Directly

### 12. Existing routes and page layout would pull too much orchestration detail into the renderer

- The current UI is page-heavy and query-heavy.
- Directly transplanting it into an Electron renderer would encourage business and privileged logic to leak upward.

### 13. Current shared contracts are REST-oriented

- Existing shared types target HTTP API payloads and server validation.
- Evidence:
  - [packages/shared/src/api.ts](/Users/zacharyzhang/Documents/Github/paperclip/packages/shared/src/api.ts)
  - [packages/shared/src/types](/Users/zacharyzhang/Documents/Github/paperclip/packages/shared/src/types)

Impact:

- Desktop IPC contracts need operation-specific schemas, privilege labels, and request/response/error shapes rather than generic REST reuse.

### 14. Current database layer is PostgreSQL-first

- Evidence:
  - [packages/db/src/schema](/Users/zacharyzhang/Documents/Github/paperclip/packages/db/src/schema)
  - [doc/DATABASE.md](/Users/zacharyzhang/Documents/Github/paperclip/doc/DATABASE.md)

Impact:

- The desktop app needs an embedded local database with explicit migration and recovery semantics. The current schema is a strong domain reference, but not a direct persistence drop-in.

## Valuable Assets To Reuse

- Company-scoped domain language
- Agent org tree semantics
- Goal / project / issue lineage rules
- Approval lifecycle semantics
- Budget and cost event concepts
- Existing local connector adapter patterns for Codex, Claude, Gemini, OpenCode, Cursor, and generic process/http modes
- Workspace and runtime service orchestration ideas

## Rewrite Decision

AgentCompany should reuse domain concepts and selected adapter/runtime patterns, but it should not inherit the current app shell, server-centric topology, or browser-admin navigation model.
