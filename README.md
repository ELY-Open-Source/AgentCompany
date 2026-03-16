# AgentCompany

Cross-platform Electron desktop control plane for local-first AI agent companies.

AgentCompany is a standalone desktop application for managing multiple AI coding agents (Codex, Claude Code, Gemini CLI, OpenCode, Kimi Code) as an organization with goals, tasks, approvals, budgets, and audit trails.

## Quick Start

```sh
pnpm install
pnpm dev
```

## Verification

```sh
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm build
```

## Packaging

```sh
pnpm build        # Compile + package (DMG/NSIS/AppImage)
pnpm build:dir    # Compile + unpackaged directory
```

- Supported targets: macOS, Windows, Linux
- Packaging uses `electron-builder`
- Local builds use ad-hoc signing (`CSC_IDENTITY_AUTO_DISCOVERY=false`)
- Defaults to `--publish never`; override with `AGENTCOMPANY_ELECTRON_PUBLISH` env var

## Architecture

```
src/
  main/              # Electron main process, IPC, orchestration, database
  preload/           # Typed bridge (contextIsolation)
  renderer/          # React UI
  shared/            # Contracts, types shared across processes
packages/
  adapter-utils/     # Shared adapter utilities
  adapter-*/         # Per-connector adapter packages
```
