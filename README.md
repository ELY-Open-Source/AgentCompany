# AgentCompany

A desktop app that runs a company of AI agents. You set a goal. An AI CEO hires a team, splits the goal into tasks, and the agents do the work against real model providers. You watch, chat, and approve.

Electron, React, and SQLite. Company data lives in a local database; prompts go to the model providers you connect.

## Run it

Needs Node 24 and pnpm 11 (`corepack enable pnpm`).

```sh
pnpm install
pnpm dev
```

## Keys

The app ships with no keys. Add your own in **Settings > Integrations**:

| Key | Used for | Get one |
|---|---|---|
| Composio API key | Connectors page and agent connector tools | platform.composio.dev |
| logo.dev publishable key | Connector logos | logo.dev |

Model provider keys and sign-ins live in **Settings > Providers**. All keys are encrypted with the OS keychain.

## Test

```sh
pnpm verify:ci
```

Typecheck, lint, unit, contract, integration, and Electron e2e.

These run against scripted model replies, so they prove routing and state, not real-model behavior. `pnpm test:live` runs real tasks on a real provider and checks that the model reads the evidence it is given, ignores instructions planted in what it reads, and does not redo finished work. Set `AGENTCOMPANY_LIVE_PROVIDER` (a catalog key such as `openai`), `AGENTCOMPANY_LIVE_SECRET` and `AGENTCOMPANY_LIVE_MODEL`; it fails without them and spends real tokens.

## Build installers

```sh
pnpm package:win
pnpm package:mac
pnpm package:linux
```

Without an Apple Developer ID, build macOS with the ad-hoc config:

```sh
pnpm build && pnpm exec electron-builder --mac --publish never --config electron-builder.unsigned.yml
```

GitHub Actions runs `verify:ci` on pushes to `main` and on pull requests, and attaches installers to each published release.

## License

MIT
