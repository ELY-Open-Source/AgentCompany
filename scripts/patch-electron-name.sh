#!/bin/bash
# Patch the Electron.app bundle name so macOS shows "AgentCompany"
# in the dock and menu bar during development.
# This runs as a postinstall hook and is safe to re-run.

set -euo pipefail

APP_NAME="AgentCompany"

# Find the Electron.app Info.plist (works with pnpm hoisted or nested)
PLIST=$(find node_modules -path "*/electron/dist/Electron.app/Contents/Info.plist" -maxdepth 8 2>/dev/null | head -1)

if [ -z "$PLIST" ]; then
  echo "[patch-electron-name] Electron.app not found, skipping."
  exit 0
fi

# Also find helper plists
HELPERS_DIR=$(dirname "$PLIST")/../Frameworks
MAIN_PLIST="$PLIST"

echo "[patch-electron-name] Patching $MAIN_PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleName $APP_NAME" "$MAIN_PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $APP_NAME" "$MAIN_PLIST" 2>/dev/null || true

# Patch helper apps too (they show in Activity Monitor)
for HELPER in "$HELPERS_DIR"/Electron\ Helper*.app/Contents/Info.plist; do
  if [ -f "$HELPER" ]; then
    HELPER_NAME=$(basename "$(dirname "$(dirname "$HELPER")")" .app | sed "s/Electron Helper/$APP_NAME Helper/")
    /usr/libexec/PlistBuddy -c "Set :CFBundleName $HELPER_NAME" "$HELPER" 2>/dev/null || true
  fi
done

echo "[patch-electron-name] Done — dock and menu bar will show \"$APP_NAME\"."
