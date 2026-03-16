# Phase 1: ProjectManager Scope And Milestones

## Product Frame

- Product working name: `AgentCompany`
- Product type: cross-platform Electron desktop application
- Platform target: macOS, Windows, Linux
- Primary mode: local-first single-operator control plane
- Product goal: run a multi-agent company from one desktop application with explicit control over connectors, workspaces, tasks, runs, approvals, budgets, logs, and recovery

## Scope Source

- Existing Paperclip concept from `doc/GOAL.md`, `doc/PRODUCT.md`, `doc/SPEC-implementation.md`
- Rebuild constraints and product direction from `/Users/zacharyzhang/Documents/Github/paperclip/PRD.md`

## Supported MVP Domains

- Local profile with backup and restore
- Multi-company local data model
- Connector registry with capability matrix
- Agent registry and org tree
- Goals, projects, tasks, lineage
- Run orchestration with session persistence and live console
- Approval queue and governance actions
- Cost tracking and budget hard-stop behavior
- Activity timeline and run diagnostics
- Workspace and repository management
- Secret management with OS-backed encryption where available
- Packaging, signing configuration, updater wiring, and crash-safe recovery hooks

## Explicit Platform Decision

AgentCompany targets all three desktop platforms in the first implementation.

Platform-specific constraints that must be handled intentionally:

- macOS:
  - standard traffic-light window controls
  - `Cmd` modifiers in menus and shortcuts
  - notification permission behavior
  - notarization and Developer ID signing requirements
  - `safeStorage` may block while Keychain access is resolved
- Windows:
  - NSIS installer target
  - `Ctrl` modifiers in menus and shortcuts
  - AppUserModelID and toast notification expectations
  - code signing certificate requirement for trusted distribution
- Linux:
  - AppImage target with optional deb/rpm later
  - tray behavior differs by desktop environment
  - `safeStorage` backend may degrade to `basic_text`, so fallback vault behavior must stay explicit

## Delivery Milestones

### 1. Architecture Freeze

Feature scope:

- final process model
- profile/storage layout
- IPC contract surface
- connector capability model
- initial screen map

Dependencies:

- PRD audit
- Electron security research
- platform packaging research

Acceptance criteria:

- architecture docs complete
- privileged boundaries defined
- no renderer-to-Node direct access

### 2. Interactive Prototype

Feature scope:

- shell window
- top nav + sidebar + utility drawer
- onboarding flow
- fake local data rendered from real repositories/services

Dependencies:

- design system
- typed preload bridge
- renderer route skeleton

Acceptance criteria:

- navigable desktop shell
- keyboard navigation baseline
- console drawer and inspector patterns established

### 3. Internal Alpha

Feature scope:

- local SQLite profile
- connectors registry and environment checks
- agents/tasks/approvals/workspaces CRUD
- utility-process orchestrator
- real run launch for supported local connectors

Dependencies:

- repository layer
- connector host
- activity logging

Acceptance criteria:

- launch first task run from onboarding
- view live logs
- persist app state across restart

### 4. Cross-Platform Validation

Feature scope:

- window/menu differences
- path handling
- notifications
- backup/restore
- crash recovery path

Dependencies:

- packaged test builds
- platform QA checklist

Acceptance criteria:

- app boots and navigates on macOS, Windows, Linux
- core workflows verified on each target

### 5. Signed Beta Build

Feature scope:

- electron-builder config
- signing env handling
- updater channel wiring
- production logging paths

Dependencies:

- build pipeline
- signing assets

Acceptance criteria:

- signed distributables generated
- updater checks optional and disableable
- release metadata generated

### 6. Release Candidate

Feature scope:

- performance pass
- memory/resource leak pass
- e2e coverage for critical flows
- security audit fixes

Dependencies:

- alpha feedback
- perf instrumentation

Acceptance criteria:

- no known critical security issue
- no crash in scripted happy path flows
- startup and live console remain responsive under load

### 7. Production Release Readiness

Feature scope:

- release checklist
- support docs
- backup guidance
- known limitations register

Dependencies:

- verification results
- signing and packaging validation

Acceptance criteria:

- typecheck/build/tests pass or deviations are explicitly recorded
- security and packaging docs complete
- final manual QA checklist complete

## Feature Sequencing Rules

- Connector execution begins only after IPC and orchestration boundaries are documented.
- Renderer implementation begins only after screen structure and state ownership are defined.
- Packaging config begins early, but signing and updater activation stay behind environment gating.
- Kimi support is tracked explicitly. If its runtime contract remains lower capability than other first-class connectors, the UI must declare the downgrade rather than hiding it.
