# Phase 11: ProjectManager Release Readiness

## Milestone Status

- architecture freeze: complete
- interactive prototype: complete
- internal alpha desktop shell: complete
- macOS local packaging validation: complete
- signed beta build: pending signing/notarization credentials and platform-host verification
- release candidate: pending Windows and Linux package validation
- production release readiness: pending platform signing completion and final release-channel credentials

## What Is Ready

- dedicated Electron-native desktop workspace under `AgentCompany`
- explicit main / preload / renderer / shared separation
- local-first profile, secret storage, orchestration worker, IPC contracts, and desktop shell
- onboarding to first usable shell flow
- packaging configuration for macOS, Windows, and Linux
- warning-free local lint baseline across main/preload/renderer
- validation gate rerun on 2026-03-13 passed (`lint`, `typecheck`, `test:run`, `build:dir`)
- **TODO**: PR CI quality gate workflow (`.github/workflows/agent-company-pr-verify.yml`) has not been created yet
- **TODO**: Electron production fuse hardening has not been configured yet (see doc 11)
- packaging script now defaults to `--publish never` unless explicitly overridden (`AGENTCOMPANY_ELECTRON_PUBLISH` or explicit `--publish`)

## Release Ownership Boundaries

| Area | Primary owner | Backup owner | Scope boundary | Exit evidence |
| --- | --- | --- | --- | --- |
| Release gate decision | CEO / ProjectManager | Product lead | Approves go/no-go only after all gates are green; does not bypass security/platform sign-off | Signed release checklist + release tag decision |
| Signing credentials | Security Auditor | Platform Release Engineer | Manages cert issuance/rotation and secret distribution; build operators never commit secrets | Secret inventory record + cert expiry check |
| macOS signing + notarization | macOS Release Engineer | Security Auditor | Runs signed build on macOS host and validates notarization ticket | `spctl`, `codesign`, `stapler` evidence |
| Windows signing + installer trust | Windows Release Engineer | Security Auditor | Runs NSIS build on Windows host and validates Authenticode chain | `Get-AuthenticodeSignature` evidence |
| Linux package validation | Linux Release Engineer | QA lead | Builds and smoke-tests AppImage on Linux host; verifies runtime dependencies | AppImage launch and smoke checklist |
| Updater endpoint trust | Security Auditor | SRE / Infra | Owns TLS/domain trust policy and update channel integrity checks | `latest*.yml` metadata + artifact hash verification |
| Cross-platform functional smoke | QA lead | Platform engineers | Verifies startup/onboarding/task-run/approval flows on each target OS | Smoke run logs + screenshots |

## Release Checklist (Production Candidate)

- [ ] `pnpm install --frozen-lockfile` completed on release host
- [ ] `pnpm lint` passed
- [ ] `pnpm typecheck` passed
- [ ] `pnpm test:run` passed
- [ ] `pnpm build:dir` passed
- [ ] signing environment variables are set from secret manager (not shell history files)
- [ ] `AGENTCOMPANY_UPDATE_URL` points to production or staging trusted domain (not `example.invalid`)
- [ ] updater checks are enabled for release validation (`AGENTCOMPANY_DISABLE_UPDATES=false`)
- [ ] macOS signed build + notarization validation completed on macOS host
- [ ] Windows signed installer validation completed on Windows host
- [ ] Linux AppImage validation completed on Linux host
- [ ] update metadata (`latest*.yml`) and published artifacts hash-match
- [ ] secrets regression check completed (existing local secrets remain readable after upgrade)
- [ ] local data migration test completed (old profile boots and migrates without data loss)
- [ ] final go/no-go approved by CEO / ProjectManager

## Runbook

### 1. Preflight (all platforms)

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:run
pnpm build:dir
```

Expected: all commands pass; no skipped failures are allowed unless explicitly waived in release notes.

### 2. Signing Material Readiness

Prepare these values in CI secret manager or local secure vault:

- `AGENTCOMPANY_UPDATE_URL`
- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `WIN_CSC_LINK`
- `WIN_CSC_KEY_PASSWORD`
- macOS notarization credentials (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) if using Apple ID flow

Sanity check before release build:

```sh
env | rg "^(AGENTCOMPANY_UPDATE_URL|CSC_LINK|WIN_CSC_LINK|APPLE_ID|APPLE_TEAM_ID)="
```

### 3. macOS Signed Build + Notarization (native macOS host)

1. Enable release-mode updater behavior and set trusted update URL.
2. Build signed artifacts.
3. Validate signature + notarization ticket.

```sh
export AGENTCOMPANY_DISABLE_UPDATES=false
export AGENTCOMPANY_UPDATE_URL="https://updates.<your-domain>/agentcompany/stable"
export CSC_LINK="file://$HOME/.signing/agentcompany-mac.p12"
export CSC_KEY_PASSWORD="<from-secret-manager>"
export CSC_IDENTITY_AUTO_DISCOVERY=true
export APPLE_ID="<apple-notarization-account>"
export APPLE_APP_SPECIFIC_PASSWORD="<app-specific-password>"
export APPLE_TEAM_ID="<team-id>"

pnpm build -- --mac dmg zip --publish never

spctl -a -vv "build/release/mac/AgentCompany.app"
codesign -dv --verbose=4 "build/release/mac/AgentCompany.app" 2>&1 | rg "Authority=|TeamIdentifier="
xcrun stapler validate "build/release"/*.dmg
```

Notes:

- For public macOS distribution, switch `mac.hardenedRuntime` to `true` with proper entitlements before final GA build.
- Keep ad-hoc signing only for local development and internal unsigned testing.

### 4. Windows Signed Installer Validation (native Windows host)

```powershell
$env:AGENTCOMPANY_DISABLE_UPDATES = "false"
$env:AGENTCOMPANY_UPDATE_URL = "https://updates.<your-domain>/agentcompany/stable"
$env:WIN_CSC_LINK = "C:\signing\agentcompany-win.pfx"
$env:WIN_CSC_KEY_PASSWORD = "<from-secret-manager>"

pnpm build -- --win nsis --x64 --publish never

Get-ChildItem .\build\release\*.exe | Get-AuthenticodeSignature |
  Format-Table Path, Status, @{Name='Signer';Expression={$_.SignerCertificate.Subject}}
```

Expected:

- `Status` is `Valid`
- signer subject matches the intended publisher identity

### 5. Linux AppImage Validation (native Linux host)

```sh
export AGENTCOMPANY_DISABLE_UPDATES=false
export AGENTCOMPANY_UPDATE_URL="https://updates.<your-domain>/agentcompany/stable"

pnpm build -- --linux AppImage --x64 --publish never

chmod +x build/release/*.AppImage
./build/release/*.AppImage --appimage-version
```

Then run manual smoke validation on Linux:

- app launches and reaches main shell
- company/workspace/agent CRUD works
- task run + approval flow works
- settings toggle for updater works

### 6. Updater Endpoint Trust Verification

1. Validate update metadata endpoint and schema.
2. Verify published artifact hash against metadata.
3. Validate app update check in runtime.

```sh
curl -fsSL "$AGENTCOMPANY_UPDATE_URL/latest.yml" -o /tmp/latest.yml
rg "^(version|path|sha512):" /tmp/latest.yml
```

Hash verification (replace placeholders with actual artifact path/hash from metadata):

```sh
node -e "const fs=require('fs');const crypto=require('crypto');const [file,expected]=process.argv.slice(1);const got=crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');if(got!==expected){console.error('sha512 mismatch');process.exit(1)}console.log('sha512 ok');" \
  build/release/<artifact-file> \
  "<sha512-from-latest-yml>"
```

Runtime verification:

- launch packaged app with `AGENTCOMPANY_DISABLE_UPDATES=false`
- trigger `Check for updates` from Settings
- confirm request goes only to trusted `AGENTCOMPANY_UPDATE_URL` domain
- confirm unsigned/untrusted update payloads are rejected by platform signing checks

### 7. Windows/Linux Native-Host QA Gate

Required evidence per platform:

- startup success + no crash in first 5 minutes
- create company + create workspace + create task + assign agent + run once
- approve one pending approval item
- inspect logs for uncaught errors
- close/reopen app and confirm local data persistence

### 8. Release Close-Out

- publish artifacts and corresponding `latest*.yml` only after all platform owners sign off
- attach evidence bundle (command output, screenshots, hash checks, signatures)
- mark release decision in changelog/release note with approver and timestamp

## Outstanding Risks Before Public GA

- current config keeps `mac.hardenedRuntime: false`; must be enabled with release entitlements for notarized public mac builds
- no trusted production updater endpoint is configured by default (`example.invalid` fallback)
- Windows and Linux validation still requires native host execution each release cycle
