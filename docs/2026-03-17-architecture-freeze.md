# 2026-03-17 Architecture Freeze

## Supported Platform Target

The product target remains cross-platform:

- macOS
- Windows
- Linux

The current codebase can build on the local host, but release readiness is not equivalent across targets yet.

### Platform-specific constraints to preserve

- macOS
  - hidden inset title bar
  - signing and notarization required for public release
  - `safeStorage` may block on keychain access
- Windows
  - App User Model ID is required for correct notifications and taskbar integration
  - NSIS is the release target
  - code signing required for updater trust
- Linux
  - safe storage backend can fall back to weaker semantics when no secret store exists
  - Wayland window behavior is more limited than X11
  - AppImage is the primary packaged target today

## External Research Decisions

### Electron security

Based on the current Electron security checklist:

- keep `nodeIntegration: false`
- keep `contextIsolation: true`
- keep `sandbox: true`
- keep the custom `app://` protocol instead of `file://`
- validate sender URLs on every IPC entry point
- do not expose raw IPC objects in preload
- define a restrictive CSP in local renderer content

### Utility process

The current choice of `utilityProcess.fork()` is still the right worker primitive.

Reasoning:

- it keeps heavy connector execution off the renderer
- it is more aligned with Electron security guidance than broad use of `ELECTRON_RUN_AS_NODE`
- it is compatible with future fuse hardening around `runAsNode`

### Secret storage

`safeStorage` remains the primary storage contract.

Fallback rules:

- use OS-backed `safeStorage` when real encryption is available
- reject insecure runtime environments by default
- allow AES vault fallback only in explicitly allowed test/insecure modes

### Updater

`electron-updater` remains acceptable, but only if release lanes are made real.

Required implications:

- real publish endpoint
- signed macOS app
- Windows signing
- explicit metadata handling for the generic provider
- download/apply UX in-app, not just “check available”

## Process Boundary Freeze

### Main process

Owns:

- app lifecycle
- BrowserWindow creation
- custom protocol registration
- native menus / tray / dialogs / notifications
- database initialization
- worker process lifecycle
- updater lifecycle
- browser automation windows
- privileged IPC handlers

Must not:

- become the place where all query, mutation, aggregation, and orchestration code accumulates

### Preload

Owns:

- typed, minimal bridge from renderer to approved use-cases

Must not:

- expose raw `ipcRenderer`
- expose generic file-system or shell primitives
- become a mirror of every DB method

### Renderer

Owns:

- operator workflows
- presentation logic
- optimistic local UI state
- command palette / shell navigation
- empty / loading / error / review states

Must not:

- talk in raw CRUD terms when the user is performing operator flows
- own privileged state
- load whole-world snapshots forever as the only data pattern

### Utility process

Owns:

- connector execution
- per-run stream forwarding
- cancellation
- run queue scheduling local to worker

Must not:

- become the persistence layer
- own security policy decisions that belong in main

## State Ownership Model

### Renderer-local state

- selected entities
- open panels / modals
- search queries
- console UI state
- transient filter/sort state

### Persisted domain state

- companies
- connectors
- workspaces
- agents
- goals / projects / tasks
- approvals
- runs
- cost entries
- activity
- secrets
- automation rules
- workflows
- browser actions

### Runtime execution state

- active worker jobs
- agent concurrency map
- workspace lock ownership
- pending wakes
- update progress
- browser action queue

### Derived read models

These should be separated from write repositories:

- overview metrics
- inbox
- standup
- run queue / attention views
- workload and review summaries

## Storage Decision

### Current decision

Keep SQLite + WAL for this tranche.

### Constraints

- single-writer semantics remain acceptable if heavy aggregations are not kept in the same giant repository
- crash recovery must preserve unfinished run semantics
- backup / restore must remain profile-local and reversible

### Required follow-up

- split read models from write repositories
- add offset-based log readers
- keep artifacts and logs on disk, indexed in SQLite

## IPC Contract Strategy

### Contract rules

- every mutating IPC call must stay company-scoped when relevant
- large payloads should use typed request objects, not positional args
- contract names stay explicit and descriptive
- result envelopes stay structured

### Next contract change

The next contract slice will add:

- dedicated run listing / filtering reads
- chunked log reads
- connector selection in onboarding

## Renderer Information Architecture Freeze

Primary desktop sections:

1. Overview
2. Runs
3. Tasks
4. Approvals
5. Messages
6. Agents
7. Workspaces
8. Connectors
9. Costs
10. Activity
11. Settings

Secondary knowledge/operations surfaces can remain, but they should not dominate the shell.

## Milestone Mapping

### Architecture Freeze

- this document accepted

### Interactive Prototype

- shell reordered around operator workflows
- run console and runs list coherent

### Internal Alpha

- onboarding, connector health, task run, approval, message routing, and workspace inspection work together

### Cross-Platform Validation

- menu, tray, notification, and package behavior documented per OS

### Signed Beta

- updater feed real
- signing path documented and testable

### Release Candidate

- all repo quality gates green

### Production Ready

- security audit, release hardening, and operator workflow polish complete
