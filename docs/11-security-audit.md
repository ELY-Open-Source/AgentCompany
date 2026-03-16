# Phase 10: Security Auditor

## Security Posture

The desktop app now follows the required Electron baseline:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- minimal preload bridge
- no direct renderer access to filesystem, shell, or process APIs

## Verified Controls

- IPC channels are explicitly named and typed in `src/shared/contracts.ts`
- privileged handlers validate payloads with Zod on the main-process side
- IPC invocation is rejected for untrusted sender frames
- `window.open` and `webview` attachment are denied
- navigation outside approved content is blocked
- packaged renderer content is served through a controlled `app://` protocol handler with path
  traversal protection
- `openPath` is restricted to managed workspace, log, artifact, backup, and profile paths
- connector execution commands are pinned to the audited connector binary instead of renderer
  overrides
- secrets are company-scoped and secret binding resolution is company-aware
- `safeStorage` is required for production secret writes; the insecure vault fallback is limited
  to explicit test environments
- worker-to-main messages are validated at runtime before mutating run state
- **TODO**: Electron binary fuse hardening is NOT yet configured. Before public release,
  add `@electron/fuses` to disable `runAsNode`, `NODE_OPTIONS` / inspect CLI argument injection,
  enforce app-from-ASAR loading, and enable ASAR integrity validation

## Release Hygiene

- local builds do not auto-discover signing identities unless explicitly configured
- desktop packaging defaults to `--publish never` to prevent accidental channel publication from local/CI build jobs
- updater configuration remains present but still requires a real trusted update endpoint before
  public distribution
- notarization and production signing credentials are intentionally external to source control

## Open Release Conditions

The app is appropriate for internal alpha and signed beta preparation. Public production release
still requires:

- real signing credentials per platform
- notarization on macOS
- trusted update hosting
- platform-native validation for Windows and Linux installers

## Re-Verification Notes (2026-03-13)

- reran lint, typecheck, tests, and macOS directory packaging with no security regressions
- static source review confirmed no renderer-side `eval` / `new Function` usage
- privileged surface remains preload-bridged through typed IPC channels only
- `child_process.spawn` usage stays in main process and is constrained to connector command checks
