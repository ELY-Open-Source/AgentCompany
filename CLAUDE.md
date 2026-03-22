THE MOST IMPORTANT RULE: You MUST operate as a coordinated multi-agent team. All agents must strictly follow the defined roles, execution order, desktop application constraints, security boundaries, and delivery requirements. Agents must not skip phases, must not begin implementation before architecture and platform requirements are documented, and must produce concrete artifacts at each phase.

THIS TEAM EXISTS TO DESIGN, BUILD, REVIEW, OPTIMIZE, AND SHIP A PRODUCTION-GRADE CROSS-PLATFORM DESKTOP APPLICATION USING ELECTRON. ALL OUTPUTS MUST TARGET REAL ELECTRON APPLICATION WORKFLOWS, REAL MAIN PROCESS AND RENDERER PROCESS BOUNDARIES, REAL IPC SECURITY REQUIREMENTS, REAL PACKAGING REQUIREMENTS, AND REAL CROSS-PLATFORM CONSTRAINTS FOR macOS, WINDOWS, AND LINUX. DO NOT FALL BACK TO GENERIC WEB APP ADVICE. DO NOT TREAT THE DESKTOP APP AS A NORMAL WEBSITE. DEFAULT TO A SECURE ELECTRON ARCHITECTURE WITH STRICT SEPARATION BETWEEN MAIN, PRELOAD, AND RENDERER.

GLOBAL EXECUTION PIPELINE (MANDATORY ORDER)

Phase 1: ProjectManager reviews the PRD, defines scope, and establishes cross-platform desktop milestones.
Phase 2: ResearchAnalyst validates Electron capabilities, desktop UX expectations, packaging requirements, OS integration constraints, and security requirements.
Phase 3: TechnicalImplementationResearcher determines architecture, IPC model, state model, storage strategy, updater strategy, and performance approach.
Phase 4: EnterpriseArchitect validates standards, module boundaries, process separation, file structure, naming rules, and desktop engineering constraints.
Phase 5: FrontendDesigner converts product intent or provided design references into a desktop-native design system and screen structure suitable for Electron.
Phase 6: FrontendDeveloper implements the renderer application using the chosen frontend stack with desktop-aware UX.
Phase 7: BackendDeveloper implements the Electron main process, preload bridge, IPC layer, OS integrations, storage boundaries, and background services.
Phase 8: BuildVerificationEngineer validates build integrity, IPC behavior, packaging, signing configuration, updater flow, and cross-platform runtime correctness.
Phase 9: CodeReviewer optimizes correctness, warnings, performance, memory behavior, startup time, renderer responsiveness, and bundle size.
Phase 10: SecurityAuditor performs final audit for IPC safety, preload exposure, file system permissions, secrets handling, updater safety, and release hygiene.
Phase 11: ProjectManager validates final integration completeness, release readiness, and milestone closure.

Agents must never operate outside this pipeline. Implementation must not begin until scope, architecture, process boundaries, platform requirements, and design constraints are documented.

PROJECT OBJECTIVE

The goal is to produce a production-grade cross-platform desktop application using Electron with clear separation between main process, preload layer, and renderer process, strong IPC discipline, secure OS integration, maintainable architecture, stable packaging, and release-ready behavior across macOS, Windows, and Linux. The application must feel like a real desktop product rather than a website placed inside a desktop shell. Window behavior, menus, keyboard shortcuts, file dialogs, notifications, clipboard interactions, drag and drop, background tasks, persistence, and updater behavior must all be designed as desktop concerns.

PROJECT COMPLETION CRITERIA

The project is complete only when the application builds successfully for supported target platforms, type checking passes, linting passes, unit and integration tests for critical flows pass, renderer and main process communication works correctly, preload exposure is minimal and verified, packaging is valid, signing and notarization requirements are documented where relevant, auto-update strategy is defined if required, crashes and obvious runtime exceptions are eliminated, and no critical security or stability issues remain.

SUPPORTED PLATFORM TARGET

The system must explicitly define whether the app supports macOS only, Windows only, Linux only, or all three desktop targets. If the app is truly cross-platform, platform-specific differences in window chrome, file paths, menu behavior, notifications, keyboard modifiers, tray behavior, installer requirements, permissions, startup behavior, and signing or notarization requirements must be documented and handled intentionally. The application must not assume one platform’s conventions apply unchanged to another.

REPOSITORY STRUCTURE

The repository must follow a clear Electron-native structure.

repo
apps
desktop
src
main
preload
renderer
components
pages
hooks
state
services
ipc
storage
platform
utils
assets
tests
unit
integration
e2e
scripts
build
docs
electron-builder.yml
package.json
tsconfig.json
.env.example

If the project is monorepo-based, workspace boundaries must remain explicit and maintainable. If the project is single-package, process boundaries must still remain explicit and not collapse into one mixed folder.

MILESTONE STRUCTURE

The ProjectManager must define milestones using native desktop release stages. At minimum these stages include architecture freeze, interactive prototype, internal alpha, cross-platform validation, signed beta build, release candidate, and production release readiness. Each milestone must specify feature scope, technical dependencies, blockers, packaging expectations, updater expectations, and acceptance criteria.

ELECTRON SECURITY FIRST RULE

Electron security is mandatory and not optional. The application must use contextIsolation enabled by default, nodeIntegration disabled in renderer by default, sandbox enabled where feasible, and a tightly scoped preload bridge. Renderer code must never access Node.js APIs directly unless explicitly allowed through audited preload exposure. Remote code execution risk, arbitrary file access, unsafe shell execution, and unrestricted IPC are forbidden.

ARCHITECTURE DECISION RULE

Architecture must be selected based on application complexity and process separation requirements. The team must evaluate and document why the chosen renderer framework and state strategy are appropriate for the project, including how the main process, preload layer, renderer, shared types, IPC contracts, storage layer, and background jobs interact. Architecture must be decided before full implementation begins. The system must avoid both monolithic god modules and unnecessary fragmentation.

PROCESS BOUNDARY RULE

The main process owns privileged access, OS integration, window lifecycle, menus, native dialogs, updater orchestration, and sensitive operations. The preload layer exposes a minimal, typed, audited bridge. The renderer handles UI, presentation logic, local interaction state, and calls only approved preload APIs. Business-critical privileged operations must never be executed directly in the renderer. Process boundaries must remain explicit, documented, and enforced by code structure.

IPC CONTRACT RULE

All IPC channels must be typed, versioned if needed, explicitly named, and documented. Unstructured string-based ad hoc IPC is forbidden. Every IPC operation must define request shape, response shape, error shape, privilege level, timeout expectations, and validation requirements. IPC handlers must validate inputs on the privileged side before performing any filesystem, network, shell, or OS-level action.

STATE MANAGEMENT RULE

State ownership must be explicit. UI-local state, app-global state, persisted state, async loading state, window state, and background task state must be clearly separated. The renderer must not become a dumping ground for all application logic. If shared state crosses process boundaries, that transfer must be deliberate and typed. The system must document where React Query, Zustand, Redux, Context API, or other state tools are used and why.

STORAGE RULE

Persistence must be chosen deliberately based on the app’s data model and offline behavior. The team must document whether persistence uses local files, SQLite, IndexedDB, key-value storage, or another desktop-safe mechanism. Sensitive data must never be stored insecurely when OS keychain or secure credential storage is available. Migration behavior, corruption handling, backup expectations, and recovery behavior must be documented. Storage locations must follow platform conventions.

NETWORKING RULE

If networking is required, the team must define whether requests originate in the main process or renderer and why. Timeout handling, retry behavior, cancellation, auth storage, offline support, background sync, streaming, and serialization rules must be documented. The app must never assume stable connectivity. Sensitive network requests should prefer the more controlled side of the architecture when security requires it.

DESKTOP UX RULE

All UI must be designed as desktop UI, not as transplanted mobile UI or plain website UI. The design must account for resizable windows, minimum window sizes, keyboard-first workflows, hover states, focus states, menus, context menus, drag and drop, clipboard flows, file system interactions, multi-window behavior if needed, command palette if relevant, and platform-specific modifier keys. Desktop affordances must be explicit and intentional.

DESIGN SYSTEM RULE

The FrontendDesigner must convert product intent or provided references into a desktop-compatible design system and view hierarchy. Typography scale, spacing scale, color tokens, surface hierarchy, focus states, hover states, loading states, empty states, error states, disabled states, and density behavior must be defined. If the application needs light mode and dark mode, that requirement must be specified early and implemented consistently. Icons, font loading, window framing behavior, and panel layouts must be documented.

ACCESSIBILITY RULE

Accessibility is mandatory. The application must support keyboard navigation, focus visibility, sufficient color contrast, readable sizing, reduced motion behavior where applicable, semantic roles where supported by the renderer framework, and accessible labeling for important interactions. Accessibility support must be treated as a product requirement rather than an optional polish pass.

OBSERVABILITY RULE

Diagnostic output must use structured logging with clear source ownership across main, preload, and renderer. Ad hoc console logging in final output is forbidden unless routed through a controlled logging strategy. Logs must not expose secrets, tokens, local private paths unless necessary, or personal user data. Crashes, failed IPC calls, updater issues, packaging issues, and important service failures must be observable without becoming noisy or unsafe.

TESTING RULE

The application must include testing appropriate to its scope. Core logic, IPC contracts, state transitions, storage boundaries, parsing, and critical workflows should have unit or integration tests. Important user flows should have end-to-end coverage where feasible. Cross-process behaviors must be tested deliberately, not assumed. Manual verification steps must be documented where automation is impractical.

PACKAGING AND RELEASE RULE

The system must produce release output suitable for native desktop distribution. Packaging expectations must be defined per platform, including macOS app bundle and signing or notarization expectations, Windows executable or installer expectations, and Linux packaging expectations if applicable. Auto-update strategy, icons, metadata, versioning, release channel separation, environment separation, and debug-versus-release behavior must be documented. Debug-only code must not remain in release output.

PERFORMANCE RULE

The application must feel responsive and desktop-grade. Startup time, idle memory usage, renderer responsiveness, large list performance, background task isolation, bundle size, unnecessary re-renders, preload overhead, IPC latency, and window creation performance must all be reviewed. Heavy CPU work must not block the renderer. Long-running privileged tasks must not freeze the UI. Performance-sensitive paths must be identified early rather than patched late.

PROJECTMANAGER — ELECTRON PRD REVIEWER AND COORDINATOR

The ProjectManager reviews the PRD and defines cross-platform desktop milestones, feature sequencing, dependency order, and delivery checkpoints. This role sets platform support requirements, packaging expectations, updater expectations, release stages, and coordination rules between design, renderer implementation, and main process implementation. The ProjectManager ensures that product scope remains realistic for Electron architecture and that milestone definitions are concrete enough for build execution.

RESEARCHANALYST — ELECTRON ECOSYSTEM AND DESKTOP RESEARCHER

The ResearchAnalyst researches current Electron capabilities, security recommendations, OS integration constraints, packaging requirements, secure storage options, updater options, platform-specific behavior, accessibility realities, and relevant open source implementation references. This role must distinguish between what Electron supports directly, what must be implemented through Node or native modules, and what remains risky or costly. The output must be concise, current, and implementation-relevant.

TECHNICALIMPLEMENTATIONRESEARCHER — ELECTRON DESKTOP ARCHITECTURE AND OPTIMIZATION RESEARCHER

The TechnicalImplementationResearcher studies the most efficient implementation path for the target features. This includes evaluating renderer framework choice, IPC modeling, preload API design, storage options, updater integration, worker usage, file watching, background processing, media handling, caching strategy, multi-window coordination, and memory behavior. The goal is to recommend a maintainable and performant architecture specifically for a desktop Electron application.

FRONTENDDESIGNER — DESKTOP ELECTRON UI AND UX DESIGN REVIEWER

The FrontendDesigner reviews provided design material and adapts it into a desktop-native design system and screen structure suitable for Electron. This role defines layout rules, spacing, typography, focus states, hover states, command surfaces, window-responsive behavior, toolbar behavior, panel layout, and desktop interaction flows. The design output must reflect actual desktop constraints including resizable windows, sidebars, toolbars, tabs if relevant, keyboard-first workflows, context menus, and dense information layouts where appropriate.

ENTERPRISEARCHITECT — ELECTRON CODE STANDARDS GUARDIAN

The EnterpriseArchitect enforces strict engineering rules. Main, preload, and renderer code must remain separated. No god modules are allowed. No direct Node access in renderer is allowed unless explicitly justified and audited. All IPC must be typed and validated. Secrets must never be hardcoded. Shell execution, filesystem access, and external process spawning must be isolated and strictly controlled. Reusable logic must not be duplicated. File naming must be descriptive and consistent. Shared types must be centralized. Public preload surface must be minimal. The architecture must remain secure and maintainable rather than imitating an unbounded full-trust desktop script.

FRONTENDDEVELOPER — ELECTRON RENDERER ENTERPRISE ENGINEER

The FrontendDeveloper implements the renderer application using the chosen frontend stack with strict type safety, maintainable component structure, predictable state management, desktop-aware interaction patterns, and minimal assumptions about privileged access. The renderer must consume only approved preload APIs or safe local browser APIs. The developer must implement loading states, error states, empty states, responsive window behavior, and keyboard-friendly interactions appropriate for desktop usage.

BACKENDDEVELOPER — ELECTRON MAIN PROCESS AND PRELOAD ENGINEER

The BackendDeveloper implements the Electron main process, preload bridge, IPC handlers, privileged integrations, storage access boundaries, menus, dialogs, notifications, background tasks, updater coordination, and platform integrations. This role owns sensitive operations and must validate all inputs before executing privileged actions. The preload layer must expose only minimal typed APIs. The implementation must be production-grade, secure, and aligned with the approved process model.

BUILDVERIFICATIONENGINEER — ELECTRON BUILD, PACKAGE, AND DEPLOYMENT SPECIALIST

The BuildVerificationEngineer validates local builds, packaging configuration, signing expectations, environment separation, preload bundling, IPC wiring, updater flow if applicable, installer integrity, and cross-platform runtime correctness. This role must confirm that production builds behave correctly, source maps and debug settings are handled appropriately, packaged apps launch correctly, and release artifacts are consistent with expectations.

CODEREVIEWER — ELECTRON BUILD OPTIMIZER AND PERFORMANCE TUNER

The CodeReviewer eliminates type errors, lint issues, avoidable bundle bloat, unnecessary renderer re-renders, untyped IPC paths, memory leaks, stale event listeners, preload overexposure, slow startup behavior, and privileged operations running on the wrong side of the architecture. This role reviews both correctness and runtime suitability for Electron desktop execution.

SECURITYAUDITOR — ELECTRON SECURITY AND RELEASE AUDITOR

The SecurityAuditor performs the final security and release review. Context isolation, sandbox policy, node integration policy, preload exposure, IPC validation, filesystem safety, secure credential storage, updater trust model, remote content policy, CSP strategy, shell execution boundaries, debug feature removal, and packaging hygiene must all be reviewed. The final audit must clearly state whether the application is safe and appropriate for internal alpha, public beta, or production release.

IMPLEMENTATION CONSTRAINTS

Use Electron as the desktop runtime. Maintain strict separation between main, preload, and renderer. Disable nodeIntegration in renderer by default. Enable contextIsolation by default. Use a minimal preload bridge. Validate all IPC inputs. Do not expose arbitrary filesystem, shell, or process APIs to renderer code. Do not hardcode secrets. Do not treat the desktop app as a normal website. Do not start implementation before milestone definition, architecture decision, process boundary review, platform requirement review, and design constraints are complete.

Carefully review the full `PRD.md` and then inspect every single line of the current Electron cross-platform desktop application codebase, including main process, renderer process, preload scripts, IPC architecture, window lifecycle, view structure, routing, UI flow, interaction logic, state management, local persistence, file system access, settings model, update flow, packaging configuration, platform integrations, security model, performance behavior, and all existing screens, panels, dialogs, and workflows. The current application is not usable as a real product: it lacks meaningful interaction, lacks coherent UX flow, lacks clear information hierarchy, lacks robust state handling, lacks polished desktop behavior, lacks complete feature implementation, lacks proper security boundaries, and lacks the depth required for a finished cross-platform Electron application. Treat the current build as an unusable prototype and fully redesign it into a complete, production-ready, polished desktop product.

Your task is to fully rebuild the application into a feature-complete, maintainable, performant, and production-ready cross-platform desktop experience. Do not do superficial edits. Do not only patch isolated bugs. Do not leave placeholder windows, placeholder views, placeholder copy, placeholder workflows, placeholder IPC hooks, incomplete screens, incomplete platform integrations, insecure bridges, mock logic, or “TODO” implementations. Redo the whole application in depth. This includes but is not limited to: full product flow, onboarding, window structure, multi-panel layout if relevant, navigation, keyboard and mouse interactions, drag-and-drop if relevant, empty states, loading states, error states, visual hierarchy, interaction feedback, text content, settings flow, persistence, async/background task coordination, IPC boundaries, file workflows, command palette if relevant, system integrations, update behavior, and overall product cohesion.

Build the app as if it must stand on its own as a real commercial desktop product, not a demo. Every screen must have purpose. Every control must have a clear function. Every interaction must produce visible and coherent feedback. Every major section must have readable information architecture, UX integrity, visual hierarchy, and product meaning. Add proper onboarding so a first-time user can understand what to do. Add product structure so the app has a reason to be used continuously. Add all missing interaction logic. Add polished UI presentation. Add complete user-facing text wherever necessary. Add proper settings, logs, history, file/workspace flow, shortcuts, menus, dialogs, and desktop-native behaviors expected from a serious Electron application.

You must work systematically and deeply, not lazily. First, audit the entire PRD and the full codebase. Identify all broken, missing, shallow, placeholder, insecure, or incoherent systems. Then redesign the application architecture where needed so the final result is maintainable and expandable. Then implement the full app end to end. Rewrite systems if the current ones are fundamentally bad. Replace weak screens if needed. Replace weak state flow if needed. Replace weak IPC design if needed. Rewrite copy, flows, and interaction logic if needed. Improve visual design, event handling, async coordination, security boundaries, state transitions, platform adaptation, and UX details so the result feels intentional and complete.

The rebuilt application must be truly designed for Electron and desktop-quality behavior, not just a web page wrapped in a shell. Respect the Electron architecture properly. Build a clean separation between main process, renderer process, and preload layer. Use secure IPC patterns. Minimize attack surface. Use context isolation, disable unsafe defaults, expose only explicit preload APIs, and avoid insecure renderer access to Node capabilities. Handle native menus, window controls, file dialogs, notifications, clipboard access, deep links, protocol handlers, and OS integrations properly where relevant. The final product must feel like a serious desktop application on macOS, Windows, and Linux, not a browser tab pretending to be native.

Prefer a production-grade Electron architecture and implementation style: strong module boundaries, explicit state ownership, clear separation between UI, domain logic, desktop integration, and persistence, predictable async execution, structured IPC contracts, robust error propagation, structured logging, testable units, maintainable packaging, and release-ready update strategy. If the current stack is weak or inconsistent, replace it with a maintainable Electron-native architecture.

If relevant, support:

- Multi-window or multi-panel workflows.
- Workspace/project-based usage model.
- Local-first persistence where appropriate.
- File system integration, drag-and-drop, import/export, and artifact management.
- Keyboard-first desktop workflows and command palette behavior.
- Run history, logs, diagnostics, and error surfacing.
- Auto-update flow where appropriate.
- Crash handling, recovery, and safe state restoration.
- Cross-platform packaging and runtime stability.
- Clear security hardening across main, preload, and renderer boundaries.

Deliverables must include:

1. A full design and engineering audit of the current PRD and codebase, listing all major problems and why they make the application incomplete, insecure, or unusable.
2. A complete redesign plan aligned with the PRD, including product flow, screen and window structure, navigation model, interaction model, IPC model, state model, persistence model, platform behavior, security model, and feature structure.
3. A clear Electron architecture covering main process responsibilities, renderer responsibilities, preload API surface, IPC contracts, permissions, and security boundaries.
4. Full implementation of all missing or broken systems in code.
5. Fully functional screens, dialogs, panels, and workflows with complete interactions, guidance, and cross-platform desktop behavior.
6. Complete user-facing copy and content where required, not placeholders.
7. Full onboarding and product flow implementation from first launch to continued daily use.
8. Proper animation and transition polish where technically appropriate for a desktop app.
9. Application UX polish equivalent to game feel: responsiveness, feedback, clarity, smooth transitions, keyboard usability, pointer precision, and operational confidence.
10. Removal of dead code, broken systems, placeholder logic, insecure patterns, and unused structures where appropriate.
11. Packaging, updater, and runtime readiness for supported desktop platforms.
12. A final fully usable Electron cross-platform desktop application, not a partial refactor.

Rules:

- Do not be lazy.
- Do not summarize only.
- Do not stop at analysis.
- Do not leave placeholder text such as “coming soon”, “TODO”, “insert copy here”, mock screens, fake workflows, or dummy interactions.
- Do not preserve bad legacy code just for convenience.
- Do not make minimal edits when a system needs to be rebuilt.
- Do not ask for unnecessary confirmation if the PRD and codebase already contain enough direction.
- Make strong implementation decisions where needed and document them clearly.
- Maintain internal consistency across product logic, UI, state, IPC behavior, persistence, async behavior, security boundaries, and platform integration.
- Keep the visual and interaction design cohesive with a polished, premium desktop product identity.
- Respect Electron constraints and strengths, but do not use them as an excuse for weak UX, poor security, or incomplete functionality.
- Do not rush or shortcut the work. You can continuously work for a very long time if needed, including days or even non-stop work across weeks.
- You have sufficient time and effectively unlimited token budget, so depth, completeness, and quality are more important than speed.

Execution order:
Phase 1: Read and understand the entire `PRD.md`.
Phase 2: Review the entire codebase line by line and identify all structural, UX, engineering, IPC, security, platform, and packaging deficiencies.
Phase 3: Produce a concrete rebuild plan.
Phase 4: Redesign the desktop architecture across main process, renderer, preload, persistence, and platform integration.
Phase 5: Implement the rebuilt app system by system.
Phase 6: Connect all features into a complete and coherent Electron-based cross-platform desktop experience.
Phase 7: Polish UX, state flow, async behavior, IPC contracts, security, platform behavior, keyboard workflows, animation, and packaging.
Phase 8: Final verification: the application must be launchable, understandable, navigable, responsive, useful, stable, secure, and complete across supported desktop platforms.

Assume the goal is not “improve a prototype” but “finish the app for real.” Act like a principal Electron engineer, desktop architect, security engineer, product designer, UX designer, build/release engineer, and technical director combined. Produce real implementation, real workflows, and a complete result.

Each build you must clean the old build and update the version number, put the build under /build folder.

<!-- GSD:project-start source:PROJECT.md -->
## Project

**AgentCompany**

AgentCompany is a cross-platform Electron desktop application that lets a user create a fully autonomous AI company by providing just a company name, description, first goal, and deliverable. A CEO agent reads the goal, autonomously hires and organizes other AI agents, delegates tasks, and the entire company runs end-to-end — producing code, content, research, and social media output — while the human observes through a Slack-style communication hub.

**Core Value:** Zero-setup autonomous AI company: user enters a goal, agents self-organize and deliver results without human intervention.

### Constraints

- **Runtime**: Electron with strict main/preload/renderer separation, contextIsolation enabled
- **Database**: SQLite (node:sqlite built-in), local-first, no external DB dependency
- **Connectors**: Must support Claude Code, Codex, Gemini, Kimi CLI, OpenCode as first-class runtimes
- **Platforms**: macOS, Windows, Linux
- **Security**: No nodeIntegration in renderer, secrets via OS keychain, IPC validation on all channels
- **Architecture**: Service graph pattern in main process, typed IPC contracts, worker threads for execution
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.9.3 - Used across main process, preload, renderer, and all workspace packages
- HTML/CSS - Renderer UI markup and styling
- Python 3 - Icon generation utility (`scripts/generate-icons.py`)
- JavaScript - Build scripts and configuration files (`.mjs` ESM format)
## Runtime
- Node.js 22.0.0+ (minimum requirement in `package.json` engines)
- Electron 39.8.0 - Desktop application runtime for macOS, Windows, Linux
- pnpm 10.24.0 (locked) - Monorepo package manager
- Lockfile: `pnpm-lock.yaml` (177.7K) - Present and maintained
## Frameworks
- Electron 39.8.0 - Cross-platform desktop framework
- Electron Vite 5.0.0 - Build tool and dev server for Electron + Vite
- React 19.2.4 - UI component framework
- React DOM 19.2.4 - React rendering target for web
- Vite 7.0.0 - Frontend build tool and module bundler
- Electron Builder 26.8.1 - Electron app packaging and signing
- TypeScript Compiler 5.9.3 - Type checking and transpilation
- TailwindCSS 4.2.1 - Utility-first CSS framework
- Tailwind CSS Vite Plugin 4.2.1 - TailwindCSS integration with Vite
- Tailwind Merge 3.5.0 - Utility function for merging TailwindCSS class lists
- Vitest 4.1.0 - Unit/integration test runner (Vite-native)
- Playwright 1.58.2 - E2E and browser automation testing
- Framer Motion 12.36.0 - React animation library
- Phosphor Icons React 2.1.10 - Icon component library
- clsx 2.1.1 - Conditional CSS class utility
## Key Dependencies
- zod 4.3.6 - TypeScript-first schema validation (used in preload and API validation)
- electron-log 5.4.3 - Structured logging for main process and renderer
- electron-updater 6.8.3 - Auto-update management and download coordination
- @agentcompany/adapter-claude-local - Claude Code local execution adapter
- @agentcompany/adapter-gemini-local - Gemini local model adapter
- @agentcompany/adapter-codex-local - Codex-style local model adapter
- @agentcompany/adapter-kimi-local - Kimi local model adapter
- @agentcompany/adapter-opencode-local - OpenCode local model adapter
- @agentcompany/adapter-utils - Shared utilities for adapter implementations
- node:fs - File system operations
- node:path - Path manipulation (cross-platform)
- node:crypto - Cryptographic operations (encryption, UUID generation)
- node:http - HTTP server for local API (agent-facing REST API)
- node:sqlite - SQLite3 database binding (embedded, no external DB)
- node:child_process - Subprocess spawning for agent execution
- node:worker_threads - Worker thread management for orchestration
- picocolors - Terminal color output (used in adapters)
## Configuration
- Environment variables configured via `.env` (pattern: `.env.example` provided)
- Profile directory: `AGENTCOMPANY_PROFILE_DIR` or default to `{userData}/profile`
- Update URL: `AGENTCOMPANY_UPDATE_URL` (optional, for auto-update distribution)
- Unsafe mode flags: `AGENTCOMPANY_ALLOW_INSECURE_VAULT`, `AGENTCOMPANY_DISABLE_UPDATES`, `AGENTCOMPANY_DISABLE_SINGLE_INSTANCE`
- Development: `ELECTRON_RENDERER_URL` (dev server origin, set by electron-vite)
- `electron-builder.yml` - Platform-specific packaging configuration
- `electron.vite.config.ts` - Build config for main, preload, renderer processes
- `tsconfig.json` - TypeScript configuration (ES2022 target, DOM lib, strict mode)
- `.eslintrc` + TypeScript ESLint - Code linting and style enforcement
- `.npmrc` - pnpm registry and authentication settings
- TailwindCSS configuration in Vite plugin (no separate tailwind.config.ts needed in v4.2)
- CSS variables and utility class generation via Tailwind
## Platform Requirements
- Node.js 22.0.0+
- pnpm 10.24.0+
- Platform-native build tools (Xcode on macOS, Visual Studio on Windows, build-essential on Linux)
- Python 3 (for asset generation)
- **macOS:** 10.13+, Intel or Apple Silicon, hardened runtime signing
- **Windows:** Windows 7+ (NSIS installer or portable .exe), code signing optional
- **Linux:** AppImage runtime (runs on most distributions)
## Database & Persistence
- SQLite (node:sqlite, built into Node.js 22+) - Primary data store
- Location: `{profileDir}/profile.sqlite`
- Configuration: WAL mode, foreign keys enabled
- Schema: 25+ tables (companies, agents, tasks, runs, approvals, connectors, automation_rules, etc.)
- Secrets stored via SecretVault:
- `{profileDir}/profile.sqlite` - Main database
- `{profileDir}/vault.key` - Encryption key (600 permissions)
- `{profileDir}/logs/` - Agent run logs and activity records
- `{profileDir}/artifacts/` - Generated files and artifacts
- `{profileDir}/backups/` - Database backups
- `{profileDir}/window-state.json` - Window layout persistence
## Module System
- `"type": "module"` in package.json
- All imports use `import` syntax, no CommonJS `require()`
- Path aliases configured in `tsconfig.json`:
## Monorepo Structure
- Root: `package.json` (main Electron app)
- `packages/adapter-claude-local/` - Claude adapter workspace
- `packages/adapter-gemini-local/` - Gemini adapter workspace
- `packages/adapter-codex-local/` - Codex adapter workspace
- `packages/adapter-kimi-local/` - Kimi adapter workspace
- `packages/adapter-opencode-local/` - OpenCode adapter workspace
- `packages/adapter-utils/` - Shared adapter utilities
- Defined in `pnpm-workspace.yaml`
- Bundled adapters included in main app via electron-vite config (bundledMainDependencies)
## Compiler & Type Checking
- Target: ES2022
- Module: ESNext
- Strict mode enabled
- Lib: ES2023, DOM, DOM.Iterable
- Module resolution: Bundler (for Vite/esbuild)
- Skip lib check: true (faster builds)
- Isolated modules: true (Vite-compatible)
- Types from @types/node, @types/react, @types/react-dom
- Electron type definitions from electron package
- Custom types in `src/shared/types.ts`
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- TypeScript: kebab-case for filenames (e.g., `connector-auth-service.ts`, `approval-policy.ts`)
- React components: PascalCase for component files and folder names (e.g., `CompanyOnboarding.tsx`, `EntityWorkspace.tsx`)
- Component exports match filename (e.g., `CompanyOnboarding.tsx` exports `CompanyOnboarding` component)
- Utility files: kebab-case describing function/class purpose (e.g., `desktop.ts`, `formatters.ts`)
- Test files: match source filename with `.test.ts` or `.spec.ts` suffix (e.g., `database.test.ts`, `connectors.spec.ts`)
- camelCase for all function names in main, renderer, and shared code
- Descriptive verbs: `saveCompany()`, `getAgent()`, `listSnapshot()`, `parseEnvBindingText()`
- Handler functions: `registerHandle()`, `handleApprovalResolved()`, `handleTaskStatusChange()`
- Private utility functions: camelCase with leading underscore discouraged; use lowercase functions in modules instead
- React hooks: `useFocusTrap()`, `useReducedMotion()` follow React hook naming convention
- camelCase for all variables, parameters, and constants (except type names)
- Descriptive names: `companyId`, `agentId`, `taskId`, `profileDir`, `dbPath`
- Boolean variables: prefix with `is` or `has` (e.g., `isPrimary`, `hasError`, `isEncryptionAvailable`)
- Collections: use plural names (e.g., `tempDirs: string[]`, `companies: CompanyRecord[]`)
- Event handlers: `onConfirm`, `onCancel`, `onChange` following React conventions
- Temporary/loop variables acceptable if narrow scope: `i`, `pos` (position), `lead` (byte lead value)
- PascalCase for all types, interfaces, and classes
- Suffix with `Record` for database entity types (e.g., `CompanyRecord`, `AgentRecord`, `WorkspaceRecord`)
- Suffix with `Status`, `State`, or `Id` for status/state/identifier literal types
- Enums and union types: singular values in camelCase (e.g., `TaskStatus = "todo" | "in_progress" | "done"`)
- Type aliases with `Type` suffix when semantic (e.g., `NavItemDef`, `SqliteDatabase`, `CompanyScopedTable`)
- Callback/handler types: `SectionId`, `ConnectorId` for union discriminators
- IPC schemas: suffix with `Schema` (e.g., `connectorInputSchema`, `workspaceInputSchema`)
- Zod validation schemas: lowercase with `Schema` suffix, exported for validation (e.g., `companyInputSchema`)
- UPPERCASE for true constants: `BOARD_READER_ID = "__board__"`
- camelCase for module-scoped constants if configurable/derivable: `IPC_CHANNELS` (object with channel names)
- Named exports for configuration objects: `DEFAULT_LOCALE`, module-level constants `defaultValue`
## Code Style
- No explicit formatter configured; project uses TypeScript + ESLint for code quality
- Tabs or spaces not enforced; follow existing file convention (observed: 2-space indentation in samples)
- Line length: no hard limit observed; code is readable up to 120-150 characters
- Imports on separate lines within groups
- Tool: ESLint 9.38.0 with `@typescript-eslint` flat config format
- Config: `eslint.config.mjs` (flat config ESLint 9+)
- Key rules:
- Order:
- All imports use `import` (ES modules); no `require()` except in CommonJS-only contexts
- Type imports use `import type` syntax to avoid runtime bundling of types
- `@shared` → `src/shared/` - shared types, contracts, constants, localization
- `@main` → `src/main/` - main process code, database, IPC handlers
- `@renderer` → `src/renderer/` - React components, UI, state, localization
- `@preload` → `src/preload/` - preload bridge, contextBridge API surface
- Configured in: `tsconfig.base.json`, `electron.vite.config.ts`, `vitest.config.ts`
## Error Handling
- Typed result pattern: `DesktopResult<T>` = `{ ok: true, data: T } | { ok: false, error: { code: string; message: string } }`
- Helper functions: `ok<T>(data: T): DesktopResult<T>` and `fail(code: string, message: string): DesktopResult<never>`
- All IPC handlers return `DesktopResult<unknown>` for consistent error propagation
- Renderer wraps results: `unwrap<T>(result: DesktopResult<T>): T` throws on error, or check `result.ok` before accessing `data`
- Main process: validate inputs with Zod schemas before processing; return `fail()` for validation/logic errors
- Error codes: string codes like `"INVALID_COMPANY_REFERENCE"`, `"AGENT_NOT_FOUND"`, `"AGENT_APPROVAL_REQUIRED"` for client-side handling
- Used selectively: `try { ... } catch { ... }` for filesystem operations, JSON parsing, unknown exceptions
- Example: `safeRealpath()` catches symlink resolution errors and falls back to `resolve()`
- Example: `parseJson<T>()` catches JSON.parse errors and returns fallback
- Async handlers in IPC catch exceptions and log or fail; uncaught exceptions crash handler but don't crash main process
- Zod schemas for all IPC payloads (e.g., `companyInputSchema`, `workspaceInputSchema`, `agentInputSchema`)
- Schema.parse() throws on validation failure; caught at IPC boundary and converted to `fail()`
- Manual validation for business logic (e.g., `ensureCompanyExists()`, `findInvalidReference()`)
- Return `fail()` for business logic violations instead of throwing
## Logging
- Minimal console output in final release; logs routed through structured logging if implemented
- No `console.log()` in finished code; use structured logging if available
- Error conditions logged at handler level before returning `fail()`
- Debug output: conditional logging with environment variables (e.g., `process.env.DEBUG`)
## Comments
- Complex algorithms: UTF-8 boundary detection in `findUtf8Boundary()` has detailed comments explaining byte masking
- Non-obvious business logic: approval policies, agent role detection in prompts
- Regex patterns: complex SQL generation (e.g., `taskPriorityOrderSql()` commented)
- Intentional limits or workarounds: `// walk backwards past continuation bytes`
- Used sparingly; only on public API functions or complex logic
- Example: `findUtf8Boundary()` has full JSDoc explaining return value and edge cases
- Most functions rely on clear naming and type signatures instead of JSDoc
- Not enforced; presence in some files, absent in others (no strict standard)
## Function Design
- Functions kept reasonably short: most handlers 10-50 lines
- Complex business logic extracted to utility functions
- Database operations: direct SQL queries in `AppDatabase` methods (not factored into smaller functions)
- React components: functional components, often 200-500 lines for complex panels
- Named parameters via destructuring for objects: `({ registerHandle, db, ... })`
- Zod schema parsing at handler boundary: `const parsed = agentInputSchema.parse(payload)`
- Type safety: parameter types always explicit, use `type` for complex parameter objects
- Optional parameters: `?` suffix or null coalescing, not undefined defaults
- Async IPC handlers: always return `DesktopResult<T>` (sync or async)
- Sync utilities: return direct values or null/undefined for optional results
- Database methods: return entity ID (string) on save/create, throw on fatal error
- React components: void return (render output via JSX)
## Module Design
- Named exports preferred (e.g., `export function ok()`, `export class AppDatabase`)
- Default exports used only for React components or config objects
- Barrel files: not heavily used; most modules export specific functions/classes
- Type exports: always use `export type` for types, interfaces, type aliases
- `src/renderer/components/` has no index.ts; imports are specific: `import { AgentRoster } from "./components/organization"`
- `src/shared/` exports types and contracts directly from their files
- Minimal barrel file usage observed; direct imports preferred for clarity
## Specific Patterns
- Class-based: `AppDatabase` wraps SQLite with methods for each entity (saveCompany, getAgent, listSnapshot)
- Query construction: direct SQL strings with placeholders for Zod/manual validation
- Transactions: explicit transaction blocks for multi-step operations
- Path safety: `isWithinOrEqual()`, `safeRealpath()` ensure symlink attacks prevented
- Object `IPC_CHANNELS` defines all channel names as const strings
- Schemas defined in `@shared/contracts.ts` using Zod
- Payload validation: `schema.parse()` at handler entry point
- Response type: always `DesktopResult<T>` (typed, versioned implicitly)
- Functional components with hooks: `useState`, `useCallback`, `useEffect`, `useMemo`, `useRef`
- Context API for localization: `LocaleContext`, `TranslationContext`
- Type imports for props: `type NavItemDef = { ... }`
- Custom hooks: `useFocusTrap()`, `useReducedMotion()` for accessibility and motion preferences
- No state management library observed (plain React context + hooks)
- Preload API calls: `ipcRenderer.invoke()` returns Promise
- Renderer wraps in try/catch or checks `result.ok` after awaiting
- Worker process: message-based communication, postMessage pattern
- Database: synchronous (no async in AppDatabase; file I/O is sync)
- Custom focus trap hook: `useFocusTrap()` manages keyboard focus within modals
- Semantic HTML: `<button>`, `<input>`, `<label>` with proper associations
- ARIA labels observed but not exhaustive across all components
## Type Safety
- TypeScript strict mode enabled: `"strict": true` in tsconfig.base.json
- `noEmit` flag used for typecheck without build
- All external types installed: `@types/node`, `@types/react`, `@types/react-dom`
- `@typescript-eslint/no-explicit-any`: off (any allowed)
- Used selectively in database queries (`SqliteRow = Record<string, any>`) and interop code
- Prefer explicit types where possible; any as escape hatch only
- Discriminated unions for status values: `TaskStatus`, `AgentStatus`, `CompanyStatus`
- Literal unions for section IDs: `SectionId = "overview" | "inbox" | "standup" | ...`
- Type guards rare; rely on Zod validation at boundaries
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Three-tier process boundary: main process (Node.js + privileged), preload layer (context-isolated bridge), renderer (React UI)
- Monolithic main process with service graph pattern for service initialization and lifecycle
- REST API server (Agent API) on localhost for local agent automation
- SQLite database for persistence with WAL journaling
- Worker thread for isolated task execution and run management
- Typed IPC contracts with Zod validation for renderer ↔ main communication
- Event-driven architecture with domain change notifications and lifecycle events
## Layers
- Purpose: Privileged node.js runtime managing OS integration, data persistence, service coordination, and IPC
- Location: `src/main/`
- Contains: Database layer, API server, service implementations, IPC handlers, task orchestration, connector management
- Depends on: Electron, SQLite, adapter packages (Claude, Codex, Gemini), electron-updater
- Used by: Preload layer (via IPC), agent connectors (via HTTP API)
- Purpose: Minimal context-isolated bridge exposing approved APIs to renderer
- Location: `src/preload/index.ts`
- Contains: DesktopApi interface exposing 75+ IPC channels via contextBridge
- Depends on: Electron contextBridge, ipcRenderer
- Used by: Renderer process (via window.agentCompany global)
- Purpose: React-based desktop UI for company, agent, task, approval, and orchestration management
- Location: `src/renderer/`
- Contains: Components (14 major feature modules), UI library, i18n, formatters, desktop utilities
- Depends on: React 19, Framer Motion, Phosphor Icons, Tailwind CSS
- Used by: End users via Electron window
- Purpose: Shared type definitions and IPC contracts
- Location: `src/shared/`
- Contains: Type definitions (CompanyRecord, AgentRecord, TaskRecord, etc.), IPC channel constants, Zod validation schemas, locale/i18n definitions
- Depends on: Zod
- Used by: Main, renderer, preload processes
## Data Flow
- Database-driven: All domain entities (companies, agents, tasks, approvals) persisted to SQLite
- No client-side state management library (no Redux, Zustand, Context); state fetched on demand
- IPC-driven updates: Main process emits `domain-changed` event when data changes; renderer reloads snapshot
- Real-time events: Run logs, agent messages, approval notifications sent via `emitEvent()`
- Window state (position, size) persisted to JSON file via AppDatabase
## Key Abstractions
- Purpose: SQLite interface with strong typing and company-scoped queries
- Examples: `src/main/database.ts`
- Pattern: Class-based singleton with methods like `getCompanies()`, `saveTask()`, `getRunLog()`
- Security: Enforces company ownership via `belongsToCompany()` checks
- Purpose: Centralized initialization and lifecycle management of main process services
- Examples: `src/main/service-graph.ts`
- Pattern: Factory function returning object with service creation and inter-service wiring
- Services: DesktopShellService, ConnectorHealthService, OrchestrationService, AutomationService, WorkerService, BrowserActionService
- Purpose: Process and validate renderer requests with company/entity ownership checks
- Examples: `src/main/ipc-core-handlers.ts`, `src/main/ipc-core-operations-handlers.ts`, `src/main/ipc-domain-handlers.ts`
- Pattern: Handler functions registered with `ipcSupport.registerHandle()`, each validates Zod schema and ownership
- Output: `DesktopResult<T>` (success: `{ ok: true, data: T }` or error: `{ ok: false, error: { code, message } }`)
- Purpose: REST API for agent task updates, approvals, and automation triggers
- Examples: `src/main/api-server.ts`
- Pattern: Custom HTTP server (no Express) with route registration, token validation, callback injection
- Routes: POST /agents/:agentId/tasks, PATCH /tasks/:taskId, POST /approvals, POST /runs/:runId/complete
- Purpose: Manage agent task execution, wake triggers, and run queue
- Examples: `src/main/orchestration-service.ts`
- Pattern: Stateful service tracking running tasks, managing queue, coordinating with WorkerService
- Methods: `wakeAgentIfPossible()`, `queueTaskRun()`, `dispatchRunToWorker()`
- Purpose: Fire automation rules on domain events (task status change, approval resolved, etc.)
- Examples: `src/main/automation-service.ts`
- Pattern: Event dispatcher with rule evaluation and action execution (wake agent, auto-approve, etc.)
- Triggers: "task_created", "task_status_changed", "approval_resolved", "run_completed"
## Entry Points
- Location: `src/main/index.ts`
- Triggers: Electron app startup
- Responsibilities: Configure main process, create MainRuntime instance, bootstrap application
- Location: `src/main/bootstrap-application.ts`
- Triggers: Called from MainRuntime.bootstrap()
- Responsibilities: Initialize AppDatabase, create ServiceGraph, start ApiServer, register IPC handlers, create main window
- Location: `src/renderer/App.tsx`
- Triggers: React root render
- Responsibilities: Load ProfileSnapshot, route to CompanyOnboarding or main navigation, manage section state, render UI
- Locations: Various routes in `src/main/api-server.ts`
- Patterns:
## Error Handling
- IPC: All handlers return `DesktopResult<T>` with `{ ok: true, data: T }` or `{ ok: false, error: { code, message } }`
- Zod Validation: Invalid payloads caught, return `IPC_INVALID_PAYLOAD` error code
- Company Ownership: `ensureCompanyExists()` and `findInvalidReference()` prevent cross-company data access
- Connector Execution: `getConnectorExecutionReadinessIssue()` checks readiness before dispatch
- Logging: All errors logged to electron-log with sanitization (redact secrets from logs)
## Cross-Cutting Concerns
- Framework: `electron-log`
- Pattern: Structured logging in main process with severity levels (info, warn, error)
- Key logs: IPC handler invocations, connector health checks, run execution, automation rule firing
- Framework: Zod schema validation on all IPC inputs
- Pattern: Schemas defined in `src/shared/contracts.ts`, validated on handler entry
- Company Ownership: Every operation verifies `belongsToCompany()` relationship
- Token signing: `createAgentToken()` generates signed JWT with agentId, companyId, runId
- Validation: `validateAgentToken()` verifies signature and payload
- Scope: Tokens tied to specific run, expire based on application logic
<!-- GSD:architecture-end -->

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
