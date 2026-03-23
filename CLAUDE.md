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
