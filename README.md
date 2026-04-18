<p align="center">
  <img src="assets/icon.svg" width="80" height="80" alt="AgentCompany logo" />
</p>

<h1 align="center">AgentCompany</h1>

<p align="center">
  <strong>Run an AI company from your desktop.</strong><br/>
  Give it a mission. Watch agents hire, delegate, and deliver.
</p>

<p align="center">
  <a href="https://github.com/ZacharyZhang-NY/AgentCompany/releases"><img alt="Latest Release" src="https://img.shields.io/github/v/release/ZacharyZhang-NY/AgentCompany?style=flat-square&color=4a5d7a" /></a>
  <a href="https://github.com/ZacharyZhang-NY/AgentCompany/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/ZacharyZhang-NY/AgentCompany?style=flat-square&color=4a5d7a" /></a>
  <img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-4a5d7a?style=flat-square" />
  <img alt="Electron" src="https://img.shields.io/badge/electron-39.8.0-4a5d7a?style=flat-square" />
</p>

<p align="center">
  <a href="https://github.com/ZacharyZhang-NY/AgentCompany/releases">Download</a>&nbsp;&nbsp;|&nbsp;&nbsp;<a href="https://agentcompany.pages.dev">Website</a>&nbsp;&nbsp;|&nbsp;&nbsp;<a href="#what-is-agentcompany">What it does</a>&nbsp;&nbsp;|&nbsp;&nbsp;<a href="#quick-start">Quick Start</a>
</p>

---

<p align="center">
  <img src="screenshots/Dashboard.jpeg" width="800" alt="AgentCompany Dashboard — active agents, tasks, and company metrics" />
</p>

## What is AgentCompany?

You type a company name, a mission, and a first goal. AgentCompany boots a CEO agent who hires specialists, forms departments, and runs the business — writing code, drafting plans, producing research, shipping deliverables. You watch, approve, and steer through a desktop command center.

Local-first. No external services. Your data stays on your machine.

Inspired by **[Paperclip](https://github.com/paperclipai/paperclip)**.

---

## What's in the box

### 26 AI providers, one install

No CLIs to install on your PATH. No `claude` / `codex` / `gemini` binaries. The agent runtime is linked directly via [pi-mono](https://github.com/mariozechner/pi).

**5 OAuth subscriptions** — sign in with the accounts you already pay for:
Claude Pro / Max · ChatGPT Plus / Pro (Codex) · GitHub Copilot · Google Gemini CLI · Google Antigravity

**18 API-key providers:**
Anthropic · OpenAI · Google Gemini · Mistral · Groq · Cerebras · xAI · OpenRouter · Vercel AI Gateway · ZAI · OpenCode · OpenCode Go · Hugging Face · Kimi For Coding · MiniMax · MiniMax CN · Fireworks · Fireworks Firepass

**3 Cloud providers:**
Azure OpenAI (Responses API) · AWS Bedrock · Google Vertex AI

Credentials are stored encrypted at rest in a SecretVault-backed SQLite table. No plaintext, no `~/.pi/agent/auth.json`, no scattered env files.

### Two execution modes, per company

- **AI CEO** — fully autonomous. Hiring, task assignment, and deliverable publishing run without you.
- **AI Co-Founder** — human-reviewed. Hiring and deliverables pause for your decision at `hire_agent` / `document_review` / `plan_review` / `strategy_review` approval gates.

Switch any time in Settings → Execution mode.

---

## Features

### Self-organizing teams
Your AI CEO draws the org chart — recruiting specialists, creating departments, and establishing reporting lines from a single goal.

<p align="center">
  <img src="screenshots/Auto-OrgChart-Team.jpeg" width="700" alt="Auto-generated org chart with CEO and department heads" />
</p>

### Real agent-to-agent messaging
Agents coordinate through channel and direct threads — not scripted status updates. Inter-agent messages feed into each recipient's conversation transcript as first-class turns, so context travels with the work instead of being re-rendered from scratch every run.

<p align="center">
  <img src="screenshots/AI-Internal-Realtime-Message.jpeg" width="700" alt="Real-time messaging between AI agents" />
</p>

### Autonomous task management
Goals break into tasks. Agents pick them up, report progress, and escalate blockers on their own.

<p align="center">
  <img src="screenshots/Auto-Task.jpeg" width="700" alt="Autonomous task queue with goals and status tracking" />
</p>

### Human-in-the-loop approvals
Material decisions surface to the board: hiring, document delivery, plan and scope reviews, strategy reviews, budget overrides, production deploys. Approve, reject, or ask for a revision — the company respects the chain of command.

<p align="center">
  <img src="screenshots/Approval-by-Human.jpeg" width="700" alt="Human approval workflow for agent decisions" />
</p>

### AI document generation
Agents draft business plans, marketing strategies, and technical specs — kept in a shared document center linked to the tasks that produced them.

<p align="center">
  <img src="screenshots/Document-Center.jpeg" width="700" alt="Document center with AI-generated deliverables" />
</p>

### One-minute company creation
Name it, write the mission, pick a provider, choose the mode, launch. Agents are at work before your coffee.

<p align="center">
  <img src="screenshots/Onboarding.jpeg" width="700" alt="Company creation onboarding flow" />
</p>

---

## Quick Start

### Download

**[Download AgentCompany](https://github.com/ZacharyZhang-NY/AgentCompany/releases)**

macOS (Apple Silicon & Intel), Windows, Linux.

### Build from source

```sh
# Prerequisites: Node.js 22+, pnpm 10+
pnpm install
pnpm dev
```

### First run

1. **Launch.** Onboarding probes your shell PATH for `node` — agents invoke the local HTTP API through `node -e`, so a shell Node is required. Platform-specific install commands are shown if it's missing.
2. **Configure a provider.** Settings → Providers. OAuth providers open your default browser; API-key providers take a key; Azure/Bedrock/Vertex take their respective endpoint + credential config.
3. **Create a company.** Name, mission, first goal, execution mode, workspace path.
4. **Go.** The CEO starts within seconds.

---

## Verification

```sh
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm build:verify
```

## Packaging

```sh
pnpm build         # Compile + package for current platform → /build/release
pnpm build:dir     # Compile + unpackaged directory
pnpm build:current # Build for current host platform
pnpm release:local # Signed / upload release pipeline (see docs/release/local-r2.md)
```

- **Targets:** macOS (`.dmg`), Windows (`.exe` / NSIS), Linux (`.AppImage`)
- Packaging via `electron-builder`
- Local builds use ad-hoc signing (`CSC_IDENTITY_AUTO_DISCOVERY=false`)
- Defaults to `--publish never`; override with `AGENTCOMPANY_ELECTRON_PUBLISH`
- Cloudflare R2 release hosting + auto-update: `docs/release/local-r2.md`

---

## Architecture

```
src/
  main/                # Electron main process
    agent-runtime/       # RuntimeBridge, SqliteSessionStore, CostWriter
    credentials/         # CredentialStore, CredentialResolver, OAuthLoginService
    api-server/          # Agent-facing HTTP API (tasks, messages, approvals, ...)
    orchestration/       # Scheduler, run dispatch, turn context
    prompt-builder/      # System prompt assembly + API docs injection
    thread-integration/  # Thread runtime event routing
    worker/              # utilityProcess worker — direct `new Agent(...)` via pi-mono
    database/            # SQLite schema + migrations
  preload/             # Context-isolated bridge — typed DesktopApi via contextBridge
  renderer/            # React 19 UI — components, hooks, i18n, state
  shared/              # Contracts, types, Zod schemas shared across processes
```

### Key design decisions

- **Local-first.** SQLite on your machine. SecretVault-encrypted credentials. No external services required for core operation.
- **Process isolation.** `contextIsolation: true`, `nodeIntegration: false`, Zod-validated IPC. Renderer never imports `@mariozechner/pi-*`; all agent traffic is proxied through main → utilityProcess worker.
- **Runtime direct.** `@mariozechner/pi-agent-core` is a first-class dependency. The worker calls `new Agent({...})` directly — no adapter shim, no CLI shell-out.
- **Session as transcript.** Each agent's conversation persists as `session_entries` rows of pi `AgentMessage[]`. Long sessions auto-compact via `shouldCompact` + `compact` from pi-coding-agent; state survives app restarts.
- **Thread runtime.** `conversation_threads` + `conversation_events` + `thread_wait_states` sit above pi's `AgentMessage` stream so the inbox / approval / review UX is a first-class runtime concern, not UI-only veneer.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Electron 39.8.0 |
| Runtime | Node.js 22+ (bundled in Electron; shell `node` required for agent HTTP callbacks) |
| Language | TypeScript 5.9 (strict) |
| UI | React 19, Tailwind CSS 4, Framer Motion, Zustand |
| Build | electron-vite, Vite 7, electron-builder |
| Database | SQLite via `node:sqlite` (WAL mode) |
| Validation | Zod 4 |
| Agent runtime | `@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-coding-agent` |
| Testing | Vitest, Playwright |

---

## License

[MIT](LICENSE)

---

<p align="center">
  <sub>Built with quiet authority. Ship your AI company.</sub>
</p>
