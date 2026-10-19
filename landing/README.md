# AgentCompany Landing

The website for [AgentCompany](https://agent-company.dev): a 16-bit pixel-art landing page built with Next.js (static export), React and three.js, hosted on Cloudflare Pages.

## Structure

| Path | What lives there |
|---|---|
| `app/` | Page shell (`layout.tsx`, `page.tsx`, `not-found.tsx`) and `globals.css` |
| `components/sections/` | Page sections, with copy in `lib/content.ts` |
| `components/pixel/` | The pixel UI kit: dialogs, NPC speech, menus, buttons, XP bars, badges, inventory, icons, GAME OVER, HUD, and the `PaletteClock` provider |
| `components/world/` | `PixelWorld`, the three.js office diorama rendered at low resolution and quantized to the palette with ordered dithering |
| `lib/palette.ts` | The 32-colour palette per day part and season; every colour on the site comes from its CSS variables |
| `lib/pixel-icons.ts` | Hand-placed 12×12 icons |
| `lib/release-links.ts` | Release version, GitHub source and release URLs, and every download asset |
| `lib/downloads.ts` | Flat asset list and tracked `/api/download` links |
| `lib/platform.ts` | Visitor OS/architecture detection and the recommended download |
| `functions/api/` | Cloudflare Pages Functions: `download` (counts a unique download in D1, then redirects to the GitHub release asset) and `download-stats` |
| `migrations/` | D1 schema for the download counter |
| `public/_headers` | Security and cache headers |

Append `?time=dawn|day|dusk|night&season=spring|summer|autumn|winter` to preview a palette.

## Downloads and source

Installers and source code live on GitHub: <https://github.com/ELY-Open-Source/AgentCompany>. Contributions go through pull requests there.

## Updating the release

Edit `lib/release-links.ts`: bump `releaseVersion` and update each asset's file name and byte size from the release API:

```sh
curl -s https://api.github.com/repos/ELY-Open-Source/AgentCompany/releases/tags/v<version> | jq -r '.assets[] | "\(.name) \(.size)"'
```

Asset ids stay stable across releases so existing `/api/download?asset=<id>` links keep working. The download function only redirects to `https://github.com/ELY-Open-Source/AgentCompany/releases/download/`.

## Develop, test, build, deploy

```sh
npm install
npm run dev
node --import ./tests/unit/resolve-ts.mjs --test 'tests/unit/*.test.ts'
npm run build
npx wrangler pages deploy out --project-name agentcompany
```

`npm run build` writes the static site to `out/`. Pages Functions and the `DOWNLOAD_COUNTER_DB` D1 binding are configured in `wrangler.toml`; `npm run preview` serves `out/` with the functions locally.
