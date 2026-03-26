# AgentCompany — CLAUDE.md

## Project

AgentCompany is a cross-platform Electron desktop app that lets users create autonomous AI companies. A user provides a company name, description, goal, and deliverable. A CEO agent self-organizes other AI agents, delegates tasks, and the company runs end-to-end — producing code, content, research, and social media — while the human observes through a Slack-style hub.

**Core Value:** Zero-setup autonomous AI company — user enters a goal, agents self-organize and deliver.

### Constraints

- **Runtime**: Electron with strict main/preload/renderer separation, contextIsolation enabled
- **Database**: SQLite (`node:sqlite` built-in), local-first, no external DB
- **Connectors**: Claude Code, Codex, Gemini, Kimi CLI, OpenCode as first-class runtimes
- **Platforms**: macOS, Windows, Linux
- **Security**: No nodeIntegration in renderer, secrets via OS keychain, IPC validation on all channels
- **Architecture**: Service graph pattern in main process, typed IPC contracts, worker threads for execution

## Electron Security Rules

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` where feasible
- Minimal preload bridge — renderer must never access Node.js APIs directly
- All IPC channels: typed, explicitly named, Zod-validated on the privileged side
- No hardcoded secrets, no arbitrary filesystem/shell/process access from renderer
- Agent tokens: signed JWT with agentId/companyId/runId, validated before any privileged action

## Architecture

Three-tier process boundary:
- **Main** (`src/main/`): Privileged Node.js — database, API server, services, IPC handlers, orchestration, OS integration
- **Preload** (`src/preload/`): Context-isolated bridge — `DesktopApi` via `contextBridge`, 75+ typed IPC channels
- **Renderer** (`src/renderer/`): React 19 UI — components, hooks, i18n, formatters; calls only approved preload APIs

Key services in main: `AppDatabase`, `ServiceGraph`, `OrchestrationService`, `AutomationService`, `WorkerService`, `ApiServer`, `BrowserActionService`

Data flow: SQLite → IPC `domain-changed` events → renderer reloads snapshot. No client-side state library; React hooks + context only.

Result pattern: `DesktopResult<T>` = `{ ok: true, data: T } | { ok: false, error: { code, message } }`. All IPC handlers return this.

## Technology Stack

- **Electron 39.8.0** / **Node.js 22+** / **TypeScript 5.9.3** / **pnpm 10.24.0**
- **Build**: electron-vite 5.0.0, Vite 7.0.0, electron-builder 26.8.1
- **UI**: React 19.2.4, TailwindCSS 4.2.1, Framer Motion 12.36.0, Phosphor Icons 2.1.10
- **Validation**: Zod 4.3.6 — schemas for all IPC payloads in `src/shared/contracts.ts`
- **Logging**: electron-log 5.4.3, **Updates**: electron-updater 6.8.3
- **Testing**: Vitest 4.1.0 (unit/integration), Playwright 1.58.2 (E2E)
- **Adapters**: `@agentcompany/adapter-{claude,codex,gemini,kimi,opencode}-local` + `adapter-utils`

### Database & Persistence

- SQLite at `{profileDir}/profile.sqlite` — WAL mode, foreign keys, 25+ tables
- Secrets: `SecretVault` with `{profileDir}/vault.key` (600 permissions)
- Logs: `{profileDir}/logs/`, Artifacts: `{profileDir}/artifacts/`, Backups: `{profileDir}/backups/`
- Window state: `{profileDir}/window-state.json`

### Config & Env

- `AGENTCOMPANY_PROFILE_DIR` (default: `{userData}/profile`)
- `AGENTCOMPANY_UPDATE_URL`, `AGENTCOMPANY_ALLOW_INSECURE_VAULT`, `AGENTCOMPANY_DISABLE_UPDATES`, `AGENTCOMPANY_DISABLE_SINGLE_INSTANCE`
- Path aliases: `@shared` → `src/shared/`, `@main` → `src/main/`, `@renderer` → `src/renderer/`, `@preload` → `src/preload/`

### Monorepo

Root app + `packages/adapter-{claude,gemini,codex,kimi,opencode}-local/` + `packages/adapter-utils/`. Defined in `pnpm-workspace.yaml`.

## Conventions

### Naming

- Files: kebab-case (`connector-auth-service.ts`), React components: PascalCase (`CompanyOnboarding.tsx`)
- Functions: camelCase with descriptive verbs (`saveCompany()`, `handleApprovalResolved()`)
- Variables: camelCase, booleans prefixed `is`/`has`, collections plural
- Types: PascalCase, DB entities suffixed `Record` (`CompanyRecord`), schemas suffixed `Schema`
- Constants: UPPERCASE for true constants (`BOARD_READER_ID`), camelCase for derived (`IPC_CHANNELS`)

### Patterns

- ES modules only (`import`, no `require`); `import type` for type-only imports
- Named exports preferred; default exports only for React components
- Error handling: Zod validation at IPC boundary → `fail()` for errors, never throw across process boundary
- React: functional components + hooks, Context for i18n, `useFocusTrap()`/`useReducedMotion()` for a11y
- Database: class-based `AppDatabase`, direct SQL with placeholders, sync operations
- IPC: `ipcRenderer.invoke()` → `DesktopResult<T>`, handler validates with Zod then checks company ownership
- No `console.log()` in production — use `electron-log`

### Code Style

- 2-space indentation, ESLint 9 with `@typescript-eslint` flat config
- TypeScript strict mode, `any` allowed selectively (DB interop)
- Comments only for non-obvious logic; rely on clear naming and types

## Desktop UX Requirements

- Desktop-native UI: resizable windows, min sizes, keyboard-first, hover/focus states, context menus, drag-and-drop, clipboard, native menus
- Platform-aware: modifier keys, window chrome, tray behavior, file paths, notifications per OS
- Accessibility: keyboard nav, focus visibility, color contrast, reduced motion, semantic roles, ARIA labels
- Performance: responsive startup, no renderer blocking, worker threads for heavy work, minimal re-renders

## Build & Release

- Clean old build and update version number before each build; output under `/build`
- Platform targets: macOS (app bundle, signing/notarization), Windows (NSIS/.exe), Linux (AppImage)
- Debug code must not remain in release output
- Auto-update strategy via electron-updater when configured

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->

## Design Context

### Users
Builders and operators who want to spin up autonomous AI companies without managing infrastructure. They arrive with a goal, expect the system to self-organize, and watch their AI workforce execute. They care about output quality and want to feel like they're running something real — not playing with a demo.

### Brand Personality
**Bold, futuristic, ambitious.** AgentCompany is the command layer for the next era of work. The interface should project quiet authority — this is a serious tool that happens to do something extraordinary.

### Emotional Goal
**Professional pride.** The user should feel "I built something real." The interface should reinforce that their AI company is a legitimate operation — not a toy, not a gimmick, but a functioning organization they orchestrated.

### Aesthetic Direction
- **Reference**: Notion — content-first layout, gentle hierarchy, flexible workspace feel
- **Accent**: Steel slate (#4a5d7a light, #7b9cc4 dark) — formal, authoritative, professional
- **Theme**: Full light + dark mode via CSS custom properties
- **Typography**: System sans-serif for UI, JetBrains Mono for code/data
- **Icons**: Phosphor (regular + fill weights), 16-18px standard
- **Motion**: Framer Motion with cubic-bezier(0.16, 1, 0.3, 1), reduced-motion aware

### Anti-References (what this must NOT be)
- **Not toy/demo**: No cartoon illustrations, rainbow gradients, or playful AI mascots
- **Not enterprise bloat**: No overwhelming dashboards, feature overload, or Salesforce-style complexity
- **Not generic SaaS**: No cookie-cutter component libraries, stock photo energy, or bland templates
- **Not sci-fi gimmick**: No glowing neon, Matrix terminals, or over-the-top futuristic theming

### Design Principles
1. **Content over chrome** — Information density is a feature. Every element earns its place. No decorative filler.
2. **Quiet authority** — The interface should feel confident without shouting. Subtle borders, restrained color, generous whitespace.
3. **Real, not theatrical** — Agent activity should feel like watching a real company operate, not a sci-fi simulation. Status over spectacle.
4. **Desktop-native craft** — Keyboard-first, focus rings, platform-aware shortcuts, proper window management. No web-app-in-a-wrapper feel.
5. **Accessible by default** — Reduced motion, color contrast, semantic HTML, focus traps. Not an afterthought.

<!-- GSD:project-start source:PROJECT.md -->
## Project

**AgentCompany — Match Paperclip Quality Milestone**

AgentCompany is a cross-platform Electron desktop app that lets users create autonomous AI companies. A user provides a company name, description, goal, and deliverable. A CEO agent self-organizes other AI agents, delegates tasks, and the company runs end-to-end while the human observes through a Slack-style hub. This milestone closes the quality gap with the Paperclip reference implementation — bringing agent skill injection, task execution integrity, budget enforcement, session management, and UI maturity to production quality.

**Core Value:** Agents produce real, usable output — not garbage. Every run has domain knowledge (skills), validated tasks, quality gates on output, cost controls, and session continuity.

### Constraints

- **Runtime**: Electron with strict main/preload/renderer separation — no architectural changes
- **Database**: SQLite (`node:sqlite`) — implement all features within SQLite's capabilities
- **Adapters**: Preserve existing 5-adapter modular npm package structure — extend, don't replace
- **Backward compatibility**: Existing companies/agents/tasks must continue to work after migration
- **Performance**: Skill injection must not add >2s to run startup; IPC events must be <100ms
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.9.3 - All application code (main, preload, renderer, shared, packages)
- JavaScript - Build scripts and some config files
- Python - Asset generation scripts (`scripts/generate-icons.py`)
## Runtime
- Electron 39.8.0 - Cross-platform desktop framework
- Node.js 22+ - Server runtime (main process)
- pnpm 10.24.0
- Lockfile: `pnpm-lock.yaml` (present)
## Frameworks
- Electron 39.8.0 - Desktop runtime with IPC, main/preload/renderer architecture
- React 19.2.4 - UI framework in renderer process
- TailwindCSS 4.2.1 - Utility-first CSS in renderer
- Zustand 5.0.12 - Lightweight state management (renderer)
- Immer 11.1.4 - Immutable state updates
- Framer Motion 12.36.0 - Animation and motion primitives in React components
- Vite 7.0.0 - Module bundler and dev server
- electron-vite 5.0.0 - Vite config wrapper for Electron main/preload/renderer
- @vitejs/plugin-react 5.0.0 - React JSX support in Vite
- @tailwindcss/vite 4.2.1 - TailwindCSS Vite integration
- Vitest 4.1.0 - Unit/integration test runner (Node environment)
- @playwright/test 1.58.2 - E2E testing framework (`tests/e2e/playwright.config.ts`)
- ESLint 9.38.0 - Code linting with flat config
- @typescript-eslint 8.46.1 - TypeScript linting support
- eslint-plugin-react-hooks 7.0.0 - React hooks rule enforcement
- eslint-plugin-react-refresh 0.4.24 - Fast refresh support
- TypeScript 5.9.3 - Type checking (`pnpm typecheck`)
## Key Dependencies
- zod 4.3.6 - Schema validation at IPC boundaries (main, preload, renderer share contracts)
- electron-log 5.4.3 - Structured logging in main process (no console.log in production)
- electron-updater 6.8.3 - Auto-update via electron-updater (when configured)
- node:sqlite - Built-in SQLite bindings for local database (no external DB driver)
- electron.safeStorage - OS keychain integration for credential encryption
- @phosphor-icons/react 2.1.10 - Icon library (16-18px standard)
- @tanstack/react-virtual 3.13.23 - Virtual scrolling for large lists
- clsx 2.1.1 - Conditional className utility
- tailwind-merge 3.5.0 - TailwindCSS className merging
- @fontsource-variable/inter - System sans-serif for UI
- @fontsource-variable/jetbrains-mono 5.2.8 - Monospace for code/data display
- @fontsource/instrument-serif - Serif font support
- @agentcompany/adapter-claude-local - Claude Code CLI adapter (workspace:*)
- @agentcompany/adapter-codex-local - Codex CLI adapter (workspace:*)
- @agentcompany/adapter-gemini-local - Gemini CLI adapter (workspace:*)
- @agentcompany/adapter-utils - Shared adapter utilities (workspace:*)
## Configuration
- Files: `electron.vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `tests/e2e/playwright.config.ts`
- Profile directory: `{userData}/profile` (default) or `AGENTCOMPANY_PROFILE_DIR` env var
- Database: `{profileDir}/profile.sqlite` (WAL mode, foreign keys enabled)
- Window state: `{profileDir}/window-state.json`
- Artifacts: `{profileDir}/artifacts/`
- Logs: `{profileDir}/logs/`
- Backups: `{profileDir}/backups/`
- Secrets vault: `{profileDir}/vault.key` (600 permissions)
- `electron.vite.config.ts` - Main/preload/renderer entry points and aliases
- `electron-builder.yml` - Platform-specific build targets (macOS dmg/zip, Windows NSIS/portable, Linux AppImage/deb/rpm)
- `tsconfig.json` - Path aliases: `@shared`, `@main`, `@renderer`, `@preload`
- `eslint.config.mjs` - ESLint 9 flat config
- `pnpm-workspace.yaml` - Monorepo with `packages/*`
## Platform Targets
- Formats: dmg (installer), zip (portable)
- Architectures: x64, arm64
- Signing: `hardenedRuntime: true`, Gatekeeper assessment disabled
- Code sign config via: `CSC_LINK`, `CSC_KEY_PASSWORD` env vars
- Formats: NSIS (installer), portable exe
- Architectures: x64, arm64
- Code sign config via: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` env vars
- NSIS: oneClick false, perMachine false, allow custom install dir
- Formats: AppImage, deb, rpm, snap
- Architectures: x64, arm64 (AppImage/deb/snap); x64 (rpm)
- Desktop category: Development
- deb dependencies: libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0, libuuid1, libsecret-1-0
- Snap plugs: default, removable-media
## Monorepo Structure
- `packages/adapter-claude-local/` - Claude Code CLI integration
- `packages/adapter-codex-local/` - Codex CLI integration
- `packages/adapter-gemini-local/` - Gemini CLI integration
- `packages/adapter-kimi-local/` - Kimi CLI integration (not bundled in main build)
- `packages/adapter-opencode-local/` - OpenCode CLI integration (not bundled in main build)
- `packages/adapter-utils/` - Shared adapter types and utilities
## Key Scripts
- Main: `out/main/index.js` + `out/main/worker.js` (entry points in electron.vite.config.ts)
- Preload: `out/preload/index.js` (CJS format, chunked)
- Renderer: `out/renderer/` (Vite SPA bundle)
- Desktop installers: `build/release/` (platform-specific per electron-builder.yml)
## Adapter System
- `execute()` - Run code in CLI session
- `sessionCodec` - Serialize/deserialize session state
- `testEnvironment()` - Check CLI availability
- `models` - List available models
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- kebab-case for all source files: `connector-auth-service.ts`, `ipc-core-handlers.ts`, `automation-service.ts`
- React components: PascalCase when exporting components: `RuleEditor.tsx`, `CompanyOnboarding.tsx`
- Test files: kebab-case with `.test.ts` or `.spec.ts` suffix: `database.test.ts`, `autonomous-chain.spec.ts`, `notification-service.test.ts`
- camelCase with descriptive verbs: `saveCompany()`, `handleApprovalResolved()`, `checkoutTask()`, `wakeAgentIfPossible()`
- Event handlers: prefix with `handle` or `on`: `handleSave()`, `handleTaskCreated()`, `onClick()`
- Prefix boolean-returning functions with `is` or `has`: `isAgentPendingApproval()`, `hasCompany()`, `belongsToCompany()`
- camelCase for all variables: `companyId`, `workspaceId`, `agentId`, `tempDir`
- Boolean variables prefixed with `is`, `has`, or `can`: `isEditing`, `hasError`, `canApprove`
- Collections in plural form: `agents`, `tasks`, `workspaces`, `tempDirs`
- PascalCase for all types: `AppDatabase`, `DesktopResult<T>`, `CompanyRecord`, `AgentRecord`
- Database entity types suffixed with `Record`: `CompanyRecord`, `AgentRecord`, `TaskRecord`, `ApprovalRecord`, `RunRecord`
- Zod schemas suffixed with `Schema`: `companyInputSchema`, `connectorInputSchema`, `workspaceInputSchema`, `approvalDecisionSchema`
- Generic types: `DesktopResult<T>` for IPC return types, `RuleFormState` for form state interfaces
- UPPERCASE for true constants defined at module level: `BOARD_READER_ID`, `ACCENT`, `LINE`
- camelCase for derived constants/configs: `IPC_CHANNELS`, `sidebarNavDefs`, `defaultRuleForm`
## Code Style
- 2-space indentation (enforced by ESLint configuration)
- No Prettier config in repository — style guided by ESLint rules
- Line length: no hard limit enforced, but prefer reasonable wrapping
- Semicolons: required (enforced by `@typescript-eslint` defaults)
- ESLint 9 with flat config in `eslint.config.mjs`
- TypeScript ESLint rules enabled in recommended configuration
- `@typescript-eslint/no-explicit-any` set to `off` — `any` is allowed for database interop and bridge code
- `@typescript-eslint/no-unused-vars`: warn with patterns `^_` for unused parameters/variables
- Unused variables can be ignored by prefixing with underscore: `_event`, `_prevStatus`
- React Hooks: `exhaustive-deps` set to warn (not error), allowing intentional deviations
- ESLint covers: `src/**/*.{ts,tsx}`, `tests/**/*.{ts,tsx}`, `scripts/**/*.{ts,mjs}`, `packages/**/*.{ts,tsx}`
- Excluded: `node_modules/`, `out/`, `build/`, `dist/`, `coverage/`, `playwright-report/`, `test-results/`
## Import Organization
- `@shared/*` → `src/shared/` — Zod schemas, types, contract definitions, localization
- `@main/*` → `src/main/` — Database, services, IPC handlers, API server
- `@renderer/*` → `src/renderer/` — React components, hooks, UI utilities
- `@preload/*` → `src/preload/` — Context-isolated bridge APIs
- Use named exports for all utilities, services, handlers, and hooks
- Default exports only for React components (required for route-based splitting patterns)
- Example: `export function saveCompany()` not `export default saveCompany`
- Example: `export default function CompanyOnboarding()` for React components
- Use `import type` exclusively for TypeScript-only imports to enable proper tree-shaking
- Example: `import type { ProfileSnapshot, DesktopEvent } from "@shared/types";`
## Error Handling
- All IPC handlers return `DesktopResult<T>` = `{ ok: true, data: T } | { ok: false, error: { code, message } }`
- Use helper functions `ok(data)` and `fail(code, message)` from `ipc-core-common.ts`
- Example from `ipc-core-admin-handlers.ts`:
- Zod is used for all IPC payloads: `const parsed = companyInputSchema.parse(payload);`
- Zod parsing happens at the IPC boundary (main process side)
- Parse before any business logic, catch validation errors and return `fail()` with descriptive message
- Example: `const parsed = approvalDecisionSchema.parse(payload);`
- All entity operations check company ownership with `ensureCompanyExists()` and `belongsToCompany()`
- Pattern from `ipc-core-operations-handlers.ts`:
- Never throw exceptions across IPC. Always catch and return `fail(code, message)`
- Main ↔ Renderer communication must use `DesktopResult` envelope
- Database errors are caught and wrapped: `catch (error) { return fail("APPROVAL_INVALID", error instanceof Error ? error.message : "...") }`
- Use SCREAMING_SNAKE_CASE for error codes: `INVALID_COMPANY_ID`, `CONNECTOR_COMMAND_LOCKED`, `TASK_NOT_FOUND`, `APPROVAL_NOT_FOUND`
- Error codes are used by renderer to determine UI response (e.g., showing specific error message)
## Logging
- No `console.log()` in production code. Use `electron-log` instead.
- Logger injected as dependency to services: `logger: { info, error }`
- Example from `notification-service.test.ts`:
- Critical events: service initialization, crashes, recoveries
- Errors: validation failures, database errors, connectivity issues
- Debug: trace flow through complex orchestration (in dev mode)
## Comments
- Only for non-obvious logic or business rules
- Prefer clear naming and types over comments
- Example: comments explaining why a decision was made, not what the code does
- Minimal use — TypeScript types are the primary documentation
- Use JSDoc for public APIs and exported functions if return type is complex
- Example for complex types:
## Function Design
- Use object parameters (destructuring) for >3 parameters
- Example: `saveAgent({ companyId, name, role, ... })`
- Avoid parameter lists with many flags
- Explicit return types for all exported functions
- Return early for error conditions: `if (error) return fail("CODE", "message");`
- Consistent use of `DesktopResult<T>` for IPC handlers
- Use `async/await`, not promises chains
- Always handle errors in handlers: `try/catch` around database calls
- Example pattern:
## Module Design
- Named exports for utilities, services, handlers
- Default exports ONLY for React components
- Example good pattern: `export function registerCoreAdminHandlers({ ... })`
- Used in `src/renderer/components/` for organizing imports
- Example: `export { AgentCreator, AgentEditor, AgentRoster } from "./..."`
- Database and major services are class-based (e.g., `AppDatabase`, `ServiceGraph`)
- Other services are functional: `createNotificationService()`, `createEventBatcher()`
- Classes own initialization (constructor) and lifecycle (init/close methods)
## React-Specific Patterns
- All React components are functional with hooks
- No class components
- Example: `export function RuleFormModal({ open, editingRule, companyId, onClose, onSaved }: Props)`
- `useCallback()` for stable function references passed to event handlers
- `useEffect()` for side effects with proper dependency arrays
- `useMemo()` for expensive calculations and string translations
- Example from `RuleEditor.tsx`:
- Zustand store (`useAppStore`) for global UI state (sidebar collapsed, selected entities, locale)
- Local `useState()` for component-specific form state
- No Redux, Context API used only for i18n provider
- Explicit interface or inline type for all props
- Example: `function RuleFormModal({ open, editingRule, companyId, onClose, onSaved }: { open: boolean; editingRule: AutomationRuleRecord | null; ... })`
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Process boundary enforcement: main (Node.js) → preload (context-isolated) ← renderer (React)
- Service graph: loosely-coupled async services coordinated by bootstrap
- Data flow: SQLite → IPC domain-changed events → Zustand store → React UI
- Agent execution: orchestration service queues runs to worker process (child utility process)
- Automation: event-driven triggers (task created, status changed, approval resolved) dispatch workflows
- IPC pattern: `ipcRenderer.invoke()` → Zod validation → DesktopResult<T> pattern
## Layers
- Purpose: Database operations, service coordination, IPC handler registration, external API communication, worker management
- Location: `src/main/`
- Contains: Database class, service factories, IPC handlers, agent orchestration logic, API server, automation rules
- Depends on: Electron main process APIs, SQLite, node:fs, child processes via worker service
- Used by: Preload process (via ipcMain handlers), worker process (via message passing)
- Purpose: Context-isolated bridge exposing minimal DesktopApi to renderer via contextBridge
- Location: `src/preload/index.ts`
- Contains: ~75 typed IPC channel invocations, subscription to desktop events
- Depends on: Electron contextBridge, ipcRenderer, shared contracts
- Used by: Renderer process (via window.agentCompany global)
- Purpose: Display company state, handle user interactions, visualize agent execution
- Location: `src/renderer/`
- Contains: React components, Zustand store (no Redux/Redux-like), hooks, i18n context, UI utilities
- Depends on: React 19, window.agentCompany preload API, Zustand, Framer Motion
- Used by: User directly through Electron window
- Purpose: Execute agent commands in isolated child process (Electron utilityProcess)
- Location: Built from agent adapters in `packages/adapter-*/`
- Contains: Connector CLI execution, run log streaming, status reporting
- Depends on: `EnqueueRunPayload` message contract, agent connector CLIs (Claude, Codex, Gemini, Kimi, OpenCode)
- Used by: Worker service via message passing
## Data Flow
- Zustand store in `src/renderer/state/store.ts` holds:
- No Redux, no global context beyond locale/translation
- Derived state computed via hooks (e.g., `selectedAgent = agents.find(a => a.id === selectedAgentId)`)
- Snapshot updates trigger full re-computation (no partial updates)
## Key Abstractions
- Purpose: All SQLite operations, snapshot generation, business logic for data consistency
- Examples: `src/main/database.ts`
- Pattern: Class with ~100 public methods, synchronous SQLite.DatabaseSync, no ORM
- Responsibilities: CRUD for all entities, filtering/searching, metrics calculation, backup/restore, secret vault integration
- Purpose: Dependency injection and lifecycle management for 9 coordinated services
- Examples: `src/main/service-graph.ts`
- Pattern: Factory function returning object with service getters, lazy initialization via `init()`
- Services: DesktopShell, ConnectorHealth, Worker, Orchestration, Automation, Onboarding, BrowserAction, Updater, AppLifecycle
- Purpose: Agent task execution, workspace resolution, budget tracking, run queuing
- Examples: `src/main/orchestration-service.ts`
- Pattern: Factory with internal state (heartbeat timer, run cache), public methods for task/agent operations
- Coordinates with: Worker service (enqueue), Automation service (dispatch on status change), Database (persist)
- Purpose: Event-driven trigger evaluation and workflow execution
- Examples: `src/main/automation-service.ts`
- Pattern: Factory managing active execution state, async/await for workflow steps
- Triggers: task.created, task.status_changed, approval.resolved, comment.posted, document.created, run.completed
- Actions: assign_task, notify_agent, send_message, create_approval, trigger_heartbeat, escalate, cross_department_notify, auto_approve
- Purpose: Electron window lifecycle, platform integration, keyboard shortcuts, native menus
- Examples: `src/main/desktop-shell-service.ts`
- Pattern: Factory managing BrowserWindow instance, event listeners for menu/shortcut actions
- Responsibilities: window creation, state persistence, platform-specific behaviors
- Purpose: Child process lifecycle, run execution, log streaming
- Examples: `src/main/worker-service.ts`
- Pattern: Factory managing Electron utilityProcess, retry logic, consecutive wake detection
- Message types: enqueue-run (inbound), run-log/run-status/run-finished (outbound)
- Purpose: Handler registration, payload validation, sender URL verification, error sanitization
- Examples: `src/main/ipc-support.ts`
- Pattern: Factory with `registerHandle()` method for each channel, returns `DesktopResult<T>`
- Security: Verifies senderFrame.url matches trusted renderer origin (dev or app://-) before processing
## Entry Points
- Location: Electron main configuration in `electron.vite.config.ts` or `build/` entry
- Triggers: App launch via `electron .` or packaged app
- Responsibilities: Create main runtime, await bootstrap, setup single-instance lock, handle app lifecycle events
- Location: `src/renderer/main.tsx` (React root)
- Triggers: Main process creates BrowserWindow pointing to renderer dist
- Responsibilities: Mount React App component, initialize Zustand store, hydrate snapshot on first load
- Location: `src/main/ipc-core-handlers.ts` dispatches to specialized handler modules
- Handlers split across: `ipc-core-read-handlers.ts`, `ipc-core-operations-handlers.ts`, `ipc-core-work-graph-handlers.ts`, `ipc-agent-coordination-handlers.ts`, etc.
- Each handler: validates input with Zod, calls DB or service method, returns DesktopResult, publishes domain-changed on write
## Error Handling
- IPC validation: Zod schema parsing at handler entry → `sanitizeHandlerError()` converts ZodError to `IPC_INVALID_PAYLOAD`
- DB errors: Throws logged to electron-log, caught by IPC handler, returned as DesktopResult error
- Worker errors: Run status set to "failed" with errorMessage, logged to run log file
- Automation errors: Try-catch blocks log errors but continue processing other rules
- Async cleanup: `appLifecycleService` waits 3 seconds for worker child process to exit before app.exit(0)
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->
