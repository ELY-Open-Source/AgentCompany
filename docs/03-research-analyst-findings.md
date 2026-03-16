# Phase 2: ResearchAnalyst Findings

## Sources

- Electron security checklist: https://www.electronjs.org/docs/latest/tutorial/security
- Electron safeStorage API: https://www.electronjs.org/docs/latest/api/safe-storage
- Electron utilityProcess API: https://www.electronjs.org/docs/latest/api/utility-process
- electron-builder auto-update: https://www.electron.build/auto-update
- electron-builder code signing: https://www.electron.build/code-signing
- Electron releases schedule: https://releases.electronjs.org/schedule
- Electron releases index: https://releases.electronjs.org/release
- Kimi Code official product/docs entry:
  - https://www.kimi.com/code
  - https://www.kimi.com/code/docs/en/

## Electron Security Requirements

From current Electron guidance, AgentCompany must treat desktop privilege as a first-order security boundary:

- load only local packaged content in the main renderer
- keep `nodeIntegration` disabled
- keep `contextIsolation` enabled
- keep renderer sandboxing enabled where feasible
- expose a minimal preload API through `contextBridge`
- validate IPC sender and payloads
- restrict navigation and new window creation
- avoid `file://` in production and prefer a custom protocol
- define a restrictive CSP
- never expose shell or filesystem primitives wholesale to renderer code

## Runtime Version Decision

- Initial architecture research targeted Electron `41.0.0`.
- Build verification on March 12, 2026 found `better-sqlite3@12.6.2` failing native rebuild against Electron `41.0.0` / Node `24.14.0`.
- The implementation baseline is therefore pinned to Electron `39.8.0` for now.

Why this downgrade is deliberate:

- Electron `39.8.0` is still a stable release line as of March 12, 2026.
- It preserves the existing SQLite storage implementation without forcing a same-phase storage rewrite.
- The downgrade is narrower in scope than replacing persistence with a different driver while the product shell, IPC, and orchestration layers are still being completed.

Upgrade condition:

- Revisit Electron `41.x` after the SQLite layer is migrated to a compatible runtime path or the upstream native module supports the newer V8 ABI cleanly.

## Secret Storage Findings

- `safeStorage` is main-process only and uses OS-backed cryptography semantics.
- macOS: keychain-backed, app-specific protection
- Windows: DPAPI-backed, user-scope protection
- Linux: backend varies; it can degrade to `basic_text`

Product implication:

- AgentCompany should use `safeStorage` when encryption is available.
- On Linux, the app must surface the selected backend and explicitly fall back to an app-local encrypted vault when the selected backend is `basic_text` or unavailable.

## Background Processing Findings

- `utilityProcess.fork()` provides a Chromium-managed child process with Node enabled and message ports available.
- It is appropriate for orchestration work that should not block the renderer and should stay separate from window lifecycle concerns.

Product implication:

- Use a utility process for the orchestration core, run queue, workspace locks, and connector process supervision.
- Keep UI projection in renderer, privileged OS coordination in main, and long-running execution in the utility process.

## Packaging And Updater Findings

- electron-builder supports cross-platform packaging with:
  - macOS: `dmg` plus `zip`
  - Windows: `nsis`
  - Linux: `AppImage` and optional deb/rpm variants
- Auto-update via `electron-updater` relies on generated metadata files such as `latest.yml`.
- macOS auto-update requires a signed app.
- Windows signing is also supported and should be treated as a release requirement.

Product implication:

- Package targets should default to DMG/ZIP, NSIS, and AppImage.
- Update checks must be opt-in/disableable by user setting, as required by the PRD.
- Signing configuration should be environment-driven and absent values must not block local development.

## Desktop UX Research Conclusions

- Desktop-first operators need split-pane information density, not a marketing-site layout.
- Keyboard navigation, command surfaces, and context-preserving utility drawers matter more than route purity.
- File reveal, open folder, drag/drop, and copy path are standard desktop affordances and should be first-class actions.

## Connector Research Conclusions

- The current Paperclip repo already contains strong local connector patterns for Codex, Claude Code, Gemini CLI, and OpenCode.
- Kimi Code is a real official CLI offering, but its desktop integration contract requires explicit treatment instead of assuming parity with the existing adapters.

Implementation decision:

- Reuse the established adapter contract ideas from current Paperclip for supported local connectors.
- Represent advanced capability differences explicitly in the connector registry and task/run UX.
