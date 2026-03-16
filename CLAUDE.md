# AgentCompany Desktop

Cross-platform Electron desktop control plane for local-first AI agent companies.

## Tech Stack

- **Runtime**: Electron 39+, Node 22+ (node:sqlite built-in)
- **Renderer**: React 19, Tailwind CSS v4, Framer Motion, Phosphor Icons
- **Fonts**: System stack (-apple-system, Segoe UI, etc.) for body; JetBrains Mono Variable for monospace
- **State**: useState + IPC full-snapshot refresh pattern
- **Build**: electron-vite, electron-builder (DMG/NSIS/AppImage)
- **Validation**: Zod on both IPC sides (main + renderer)

## Design Context

### Users

Technical operators (solo devs, AI-native founders, engineering leads) who run multiple AI coding agents simultaneously via CLI tools like Codex, Claude Code, Kimi CLI, Gemini CLI, and OpenCode. They are power users who think in terms of organizations, budgets, and orchestration - not chat windows. Their context is a focused workstation where this app is the primary command surface for their AI workforce.

### Brand Personality

**Warm, Approachable, Clean** - like Notion meets Raycast. Professional but never cold. The interface should feel like a well-organized workspace run by someone who cares about craft, not a sterile enterprise dashboard. Friendly to newcomers but capable enough for power users.

### Emotional Goal

**Professional authority** - "I'm running a company." The operator should feel like a capable executive at their control surface. Every screen should reinforce that they are in command of their AI organization - seeing status, making decisions, taking action. Not anxious monitoring, but confident oversight.

### Aesthetic Direction

**Primary references**: Linear + Raycast
- Clean sidebar with grouped navigation
- Fast keyboard-driven navigation
- Subtle, purposeful animations (not decorative)
- Monochrome palette with one warm accent color
- Information density without clutter

**Anti-references** (what this should NOT look like):
- Cluttered enterprise dashboards (Jira, ServiceNow)
- Overly playful / illustration-heavy consumer apps
- Raw terminal UIs without visual hierarchy
- Generic Bootstrap/Material admin templates

### Theme Strategy

**System-following** - automatically match OS light/dark preference. Both themes must be maintained. The current light palette is the foundation; dark mode tokens need to be added.

### Color System

| Token | Light | Purpose |
|---|---|---|
| `--bg` | `#fbfbfb` | App background |
| `--panel` | `#ffffff` | Card/sidebar surfaces |
| `--panel-soft` | `#f4f5f5` | Active/hover states |
| `--text` | `#1a202c` | Primary text |
| `--muted` | `#718096` | Secondary/caption text |
| `--muted-strong` | `#4a5568` | Emphasized secondary text |
| `--accent` | `#c06a3a` | Warm terracotta - primary action color (~4.6:1 contrast on white) |
| `--accent-soft` | `#f7ece6` | Accent background tint |
| `--danger` | `#e5484d` | Errors, destructive actions |
| `--warn` | `#b7791f` | Warnings, budget alerts |
| `--success` | `#2f855a` | Positive states, healthy budgets |
| `--success-soft` | `#edf7f0` | Success background tint |
| `--line` | `rgba(15,23,42,0.08)` | Subtle borders |
| `--line-strong` | `rgba(15,23,42,0.14)` | Emphasized borders |

The warm terracotta accent (`#c06a3a`) is the signature color. It appears in active states, primary buttons, focus rings, and the icon fill for active sidebar items. Use sparingly - it should draw the eye to what matters.

### Typography Scale

- Page titles: 31px, -0.03em tracking
- Section headings: 18px semibold, -0.01em
- Body/labels: 14px
- Compact UI (sidebar, pills, badges): 13px, 0.005em tracking
- Captions/meta: 12px
- Micro labels (section headers, status pills): 10-11px uppercase, wide tracking (0.08-0.12em)
- Monospace (logs, IDs, timestamps): JetBrains Mono, 11-12px

### Spacing & Radius

- Border radius: 6-8px for interactive elements, 10px for cards/panels
- Sidebar width: 220px fixed
- Content max-width: 1040px centered
- Page padding: 40px horizontal, 32px vertical
- Section spacing: 56px (space-y-14) between major sections

### Animation Principles

- All transitions use `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-expo feel)
- Page transitions: 240ms, y-axis slide (12px in, -10px out)
- Panel reveals: 220ms, height or y-axis
- Hover/focus: 150ms via Tailwind `duration-150`
- Respect `prefers-reduced-motion` globally

### Icon System

Phosphor Icons (react), weight `regular` by default, `fill` for active/selected states. Standard size 16-18px. Active sidebar icons use accent color.

### Design Principles

1. **Hierarchy before density** - Use typography scale, spacing, and color to create clear visual hierarchy. Never rely on borders or backgrounds alone to separate content.
2. **Quiet until needed** - Default state is calm and minimal. Warnings, errors, and attention items earn their visual weight through color and placement, not through shouting.
3. **One accent, used with intent** - The warm terracotta accent is reserved for: active navigation, primary actions, and focus states. Everything else is greyscale. If accent appears everywhere, it means nothing.
4. **Native-feeling, not native-copying** - Feel at home on macOS (traffic lights, vibrancy cues, drag regions) but don't try to replicate AppKit. Same principle applies cross-platform.
5. **Content over chrome** - Minimize UI framework noise. Headers, borders, and navigation are scaffolding - the user's agents, tasks, and runs are the content. Maximize the ratio of useful information to decorative structure.
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