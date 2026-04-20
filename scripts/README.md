# scripts/

Build, release, and asset-generation helpers invoked from `package.json`
or from the release pipeline. Every top-level script has a single owner
and is wired up either as an npm script or as a child of `release-boss.mjs`.

## Layout

| Path                          | Purpose                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------ |
| `postinstall.mjs`             | Ran by pnpm after install; stamps Electron name patches and env dependencies. |
| `build-desktop.mjs`           | `pnpm build` entry. Wraps `electron-builder` with AgentCompany defaults.       |
| `build-all-platforms.mjs`     | `pnpm build:current` entry. Cross-platform matrix driver for local testing.   |
| `build/`                      | Auxiliary assets consumed by electron-builder (entitlements, installer hooks). |
| `electron-builder-mac-sign.mjs` | macOS codesign + notarize helper invoked from electron-builder `afterSign`. |
| `patch-electron-name.sh`      | Rewrites the Electron binary name into `AgentCompany` so macOS treats it as a distinct app. |
| `release/`                    | Shared helpers imported by `release-*` scripts.                                |
| `release-boss.mjs`            | `pnpm release:boss` entry. Builds the Boss edition bundle and uploads it.     |
| `release-local.mjs`           | `pnpm release:local` entry. Packages a local-only build for internal testers. |
| `release-local/`              | Fixtures / templates consumed by `release-local.mjs`.                          |
| `release-public-cloudflare.mjs` | `pnpm release:cloudflare:public` entry. Publishes the public release to Cloudflare R2. |
| `generate-landing-release-links.mjs` | Regenerates the landing-page download links from the Cloudflare manifest. |
| `icons/`                      | Icon generation utilities. See `icons/generate-icons.py`.                      |

## Icons

`pnpm assets:generate` runs `scripts/icons/generate-icons.py`, a
macOS-only helper that rebuilds the Electron app icon, the landing-page
favicons, and the tray icons from the SVG masters in `assets/`. Only
re-run it when the SVG sources change; the committed PNG / ICNS outputs
are consumed directly at build time.

## Release

`pnpm release:cloudflare` invokes `release-public-cloudflare.mjs`
followed by `release-boss.mjs`. The Boss edition bundles additional
credentials and is uploaded to a private bucket; never commit its
outputs (see the `boss-build/` entry in `.gitignore`).

## Conventions

- Scripts here are invoked from CI and from local dev. They must run
  without network access except where explicitly required (release
  uploads). Any tool requirement (e.g. `cairo`, `iconutil`) belongs in
  the script's header comment with install instructions.
- Treat `scripts/` as source, not generated output. Do not commit
  build artefacts into subdirectories beyond the fixtures under
  `build/` and `release-local/`.
