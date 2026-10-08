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
| Google Antigravity OAuth client secret | Google Antigravity sign-in | Google |

Model provider keys and sign-ins live in **Settings > Providers**. All keys are encrypted with the OS keychain.

## Test

```sh
pnpm verify:ci
```

Typecheck, lint, unit, contract, integration, replay-eval, and Electron e2e.

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
