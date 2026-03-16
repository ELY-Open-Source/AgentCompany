# Phase 4: EnterpriseArchitect Standards

## Top-Level Structure

```text
AgentCompany/
  assets/
  build/
  docs/
  scripts/
  src/
    main/
    preload/
    renderer/
    shared/
  tests/
    unit/
    integration/
    e2e/
  electron-builder.yml
  package.json
  tsconfig.json
  .env.example
```

## Process Boundaries

### Main process owns

- window lifecycle
- app protocol registration
- IPC gateway
- menu construction
- native dialogs
- notifications
- updater
- backup/restore coordination
- safeStorage and vault bridge

### Preload owns

- narrow typed API
- event subscription bridge
- no business logic
- no dynamic API exposure

### Renderer owns

- UI composition
- read-only projections
- local interaction state
- invoking approved preload methods

### Utility process owns

- run execution
- connector process supervision
- workspace and agent locking
- timeout handling
- normalized event emission

## Naming Rules

- Use descriptive file names by role: `connector-service.ts`, `run-controller.ts`, `profile-repository.ts`
- Shared schemas live under `src/shared`
- No renderer component may import from `src/main`
- No preload module may import from `src/renderer`

## IPC Rules

- All channels are constants in `src/shared/contracts/ipc.ts`
- Every handler validates input with Zod before executing
- Response shape is always `{ ok, data, error }`
- Errors use explicit codes, never arbitrary thrown text at the renderer boundary

## Security Rules

- `contextIsolation: true`
- `sandbox: true` for renderer window
- `nodeIntegration: false`
- navigation locked to `app://` content
- `window.open` denied unless explicitly whitelisted
- shell execution restricted to orchestration/connector host
- connector env injection uses allowlists, never raw `process.env`

## Resource Lifetime Rules

Following the memory-safety constraints for long-lived desktop processes:

- every event subscription returns a disposer
- every spawned child process is registered and terminated on app shutdown
- timers are stored centrally and cleared on teardown
- database handles are singleton-owned and closed during quit/update install
- utility-process channels are recreated deterministically after crash or restart

## Module Boundaries

- `src/shared`: pure types, schemas, ipc contracts, constants
- `src/main/platform`: OS integration, menu, notifications, paths
- `src/main/storage`: SQLite, migrations, repositories
- `src/main/services`: profile, connectors, backups, updater, IPC composition
- `src/main/orchestrator`: utility-process bootstrap and bridge
- `src/renderer/pages`: route-level views
- `src/renderer/components`: reusable UI primitives and panels
- `src/renderer/state`: UI store, query clients, preferences

## Non-Negotiable Constraints

- No ad hoc IPC from components
- No direct filesystem or shell access in renderer
- No secrets in renderer state
- No mixed god service containing windows, db, and orchestration together
- No placeholder routes or dead menu entries
