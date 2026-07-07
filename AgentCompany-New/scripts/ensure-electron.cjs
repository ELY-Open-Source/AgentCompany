#!/usr/bin/env node
/*
 * Ensures the Electron binary exists after `pnpm install`.
 *
 * On some Windows/Node combos electron's own install script dies silently:
 * its extract-zip dependency drops the event loop mid-extraction and the
 * process exits 0 with a partial `dist/` and no `path.txt`, which later makes
 * electron-vite fail with "Error: Electron uninstall". The download/cache
 * layer (@electron/get) is unaffected, so when that happens we fetch the zip
 * through it and extract with the OS-native unzipper instead.
 *
 * No-op when the binary is already in place (the normal case on macOS/Linux).
 */
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const electronPkgJson = require.resolve('electron/package.json');
const electronDir = path.dirname(electronPkgJson);
const electronRequire = createRequire(electronPkgJson);

const platformPath = {
  win32: 'electron.exe',
  darwin: 'Electron.app/Contents/MacOS/Electron',
  mas: 'Electron.app/Contents/MacOS/Electron',
}[process.platform] || 'electron';

function isInstalled() {
  try {
    return (
      fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf8') === platformPath &&
      fs.existsSync(path.join(electronDir, 'dist', platformPath))
    );
  } catch {
    return false;
  }
}

function extractNatively(zipPath, dist) {
  if (process.platform === 'win32') {
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${dist}" -Force`,
    ], { stdio: 'inherit' });
  } else if (process.platform === 'darwin') {
    // ditto preserves the Electron.app symlinks and executable bits
    execFileSync('ditto', ['-xk', zipPath, dist], { stdio: 'inherit' });
  } else {
    execFileSync('unzip', ['-oq', zipPath, '-d', dist], { stdio: 'inherit' });
  }
}

async function main() {
  if (isInstalled()) return;

  // Normal route: electron's own installer (covers the case where pnpm
  // skipped its build script).
  try {
    execFileSync(process.execPath, [path.join(electronDir, 'install.js')], { stdio: 'inherit' });
  } catch {
    // fall through to the manual route
  }
  if (isInstalled()) return;

  console.log('[ensure-electron] electron install script left no binary; extracting manually...');
  const { downloadArtifact } = electronRequire('@electron/get');
  const { version } = electronRequire('./package.json');
  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    cacheRoot: process.env.electron_config_cache,
    checksums: electronRequire('./checksums.json'),
    platform: process.platform,
    arch: process.arch,
  });

  const dist = path.join(electronDir, 'dist');
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  extractNatively(zipPath, dist);

  const typeDef = path.join(dist, 'electron.d.ts');
  if (fs.existsSync(typeDef)) {
    fs.renameSync(typeDef, path.join(electronDir, 'electron.d.ts'));
  }
  fs.writeFileSync(path.join(electronDir, 'path.txt'), platformPath);

  if (!isInstalled()) {
    throw new Error('Electron binary still missing after manual extraction');
  }
  console.log('[ensure-electron] Electron binary restored.');
}

main().catch((err) => {
  console.error('[ensure-electron] failed:', err);
  process.exit(1);
});
