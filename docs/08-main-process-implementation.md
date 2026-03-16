# Phase 7: BackendDeveloper Main Process And Preload Implementation

## Main Process Responsibilities Implemented

- single-instance lock with focus restoration on second launch
- secure `BrowserWindow` creation with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`
- custom `app://` protocol for packaged renderer content
- application menu, accelerators, native dialogs, and notifications
- typed IPC registration with sender validation and schema validation
- local SQLite profile bootstrap, backup, restore, and settings persistence
- utility-process orchestration worker for run execution and log/status fan-out
- updater wiring via `electron-updater`, gated by settings and environment

## Preload Bridge

- single exposed surface: `window.agentCompany`
- no raw Node.js or Electron APIs exposed to renderer
- typed invoke helpers only
- renderer event subscription returns unsubscribe function and hides raw Electron event objects

## Storage And Secrets

- `node:sqlite` database under profile directory
- WAL enabled
- logs, artifacts, and backups stored as profile files
- secrets encrypted with Electron `safeStorage` when available, otherwise vault fallback

## Key Files

- [index.ts](/Users/zacharyzhang/Documents/Github/paperclip/AgentCompany/src/main/index.ts)
- [database.ts](/Users/zacharyzhang/Documents/Github/paperclip/AgentCompany/src/main/database.ts)
- [vault.ts](/Users/zacharyzhang/Documents/Github/paperclip/AgentCompany/src/main/vault.ts)
- [worker.ts](/Users/zacharyzhang/Documents/Github/paperclip/AgentCompany/src/main/orchestrator/worker.ts)
- [index.ts](/Users/zacharyzhang/Documents/Github/paperclip/AgentCompany/src/preload/index.ts)
- [contracts.ts](/Users/zacharyzhang/Documents/Github/paperclip/AgentCompany/src/shared/contracts.ts)
