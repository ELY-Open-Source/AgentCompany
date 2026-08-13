#!/usr/bin/env node
/*
 * Attaches installer artifacts from release/ to the Gitea release that
 * triggered the workflow. The new asset is uploaded first and only then are
 * older same-named assets deleted (Gitea allows duplicate attachment names),
 * so a failed re-run never removes a previously good download.
 *
 * Required env: GITHUB_SERVER_URL, GITHUB_REPOSITORY (set by the runner),
 * GITEA_TOKEN, RELEASE_ID (set by the workflow step).
 */
import fs from 'node:fs';
import path from 'node:path';

const server = process.env.GITHUB_SERVER_URL;
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITEA_TOKEN;
const releaseId = process.env.RELEASE_ID;

for (const [name, value] of Object.entries({ GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITEA_TOKEN: token, RELEASE_ID: releaseId })) {
  if (!value) {
    console.error(`missing required env var ${name}`);
    process.exit(1);
  }
}

const apiBase = `${server.replace(/\/$/, '')}/api/v1/repos/${repo}/releases/${releaseId}`;
const authHeader = { Authorization: `token ${token}` };

const INSTALLER_EXTS = new Set(['.exe', '.dmg', '.zip', '.AppImage', '.deb']);
const releaseDir = path.resolve('release');

const files = fs
  .readdirSync(releaseDir, { withFileTypes: true })
  .filter((e) => e.isFile() && INSTALLER_EXTS.has(path.extname(e.name)))
  .map((e) => e.name)
  .sort();

if (files.length === 0) {
  console.error(`no uploadable artifacts found in ${releaseDir}`);
  process.exit(1);
}

const releaseRes = await fetch(apiBase, { headers: authHeader });
if (!releaseRes.ok) {
  console.error(`failed to fetch release ${releaseId}: ${releaseRes.status} ${await releaseRes.text()}`);
  process.exit(1);
}
const existingAssets = (await releaseRes.json()).assets ?? [];

for (const name of files) {
  const filePath = path.join(releaseDir, name);
  const sizeMb = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);

  const stale = existingAssets.filter((a) => a.name === name);

  const form = new FormData();
  form.append('attachment', await fs.openAsBlob(filePath), name);
  const res = await fetch(`${apiBase}/assets?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: authHeader,
    body: form,
  });
  if (!res.ok) {
    console.error(`failed to upload ${name}: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  console.log(`uploaded ${name} (${sizeMb} MB)`);

  for (const asset of stale) {
    const del = await fetch(`${apiBase}/assets/${asset.id}`, { method: 'DELETE', headers: authHeader });
    if (!del.ok && del.status !== 404) {
      console.error(`failed to delete stale asset ${name} (id ${asset.id}): ${del.status} ${await del.text()}`);
      process.exit(1);
    }
    console.log(`deleted stale asset ${name} (id ${asset.id})`);
  }
}

console.log(`done: ${files.length} asset(s) attached to release ${releaseId}`);
