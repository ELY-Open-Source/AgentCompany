# Phase 3: TechnicalImplementationResearcher Decisions

## Architecture Choice

- Runtime: Electron `39.8.0`
- Renderer: React + Vite + TypeScript
- UI motion: Framer Motion, used selectively for layout transitions, state feedback, and utility-drawer choreography
- Data: SQLite with WAL mode and a single-writer orchestration queue
- Orchestration: Electron utility process
- Packaging: electron-builder
- Updates: `electron-updater`, gated by app settings and environment

## Why This Stack

- Electron is required by the project constraints and matches the need for local CLI/runtime orchestration.
- React is already aligned with repo knowledge and keeps renderer iteration fast.
- SQLite with WAL provides embedded local durability and low setup overhead, matching the PRD requirement to start without external database installation.
- A utility process avoids freezing the renderer during process supervision, lock management, or log ingestion.

Version note:

- Electron `41.0.0` was evaluated first, but the shipping baseline moved to `39.8.0` because the current SQLite native dependency did not rebuild cleanly on the newer runtime during packaging verification.

## State Ownership

### Renderer-only state

- split-pane layout and inspector visibility
- filter/search state
- command palette visibility
- form drafts
- optimistic mutation feedback

### Main-process privileged state

- windows
- menus
- file dialogs
- notifications
- backup/import/export paths
- updater lifecycle
- safeStorage encryption/decryption

### Utility-process orchestration state

- connector child process registry
- run queue
- workspace write locks
- per-agent concurrency locks
- session persistence and resume eligibility
- unfinished run reconciliation

### Persisted local state

- companies
- connectors and connector config documents
- workspaces
- agents
- goals/projects/tasks
- approvals and comments
- runs, run events, cost events
- activity log
- app settings and window state

## IPC Model

IPC is split into three layers:

1. Renderer to preload:
   - typed methods only
   - no raw channel strings in UI components
2. Preload to main:
   - schema-validated request/response handlers
   - sender verified in main
3. Main to utility process:
   - internal command bus over message ports
   - used for orchestration, not for UI privilege elevation

## Storage Strategy

- Database file: `profile.sqlite` under app profile data directory
- WAL enabled
- Attachments/logs/artifacts stored as files, indexed in SQLite
- Secrets stored via `safeStorage` when available; otherwise fallback encrypted vault plus explicit risk state on Linux
- Backups stored as timestamped archives under `backups/`

## Performance Strategy

- Renderer subscribes to normalized event streams instead of raw connector protocol noise
- Utility process owns long-running child processes
- Log viewer uses chunked pagination and windowed rendering
- Expensive derived summaries are computed in main/utility and sent as projections

## Connector Strategy

Connector contract layers:

- required:
  - detect installation
  - health/auth check
  - execute
  - normalize stdout/stderr/events
  - declare capability matrix
- optional:
  - session resume
  - graceful cancel
  - model discovery
  - structured transcript
  - cost attribution

## Updater Strategy

- default channel: disabled unless configured
- manual update check available from app menu and settings
- before install:
  - write backup manifest
  - flush db/log handles
- if signature validation fails:
  - reject install
  - record audit event

## Failure Model

- app restart scans unfinished runs
- stale running records become `interrupted`
- retryable runs expose resume/retry actions in UI
- workspace lock conflicts enqueue runs as `queued`
- connector health failures block new run dispatch
