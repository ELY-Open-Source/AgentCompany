// Gitea release for the pushed tag: `create` checks the tag against package.json and opens the release; `upload` attaches installers.
import { openAsBlob } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

const INSTALLER = /\.(exe|dmg|zip|AppImage|deb)$/;

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

const api = `${env("GITHUB_SERVER_URL")}/api/v1/repos/${env("GITHUB_REPOSITORY")}`;
const tag = env("GITHUB_REF_NAME");
const headers = { Authorization: `token ${env("GITEA_TOKEN")}` };

async function call(method, path, body) {
  const response = await fetch(`${api}${path}`, { method, headers: body instanceof FormData ? headers : { ...headers, "Content-Type": "application/json" }, body: body instanceof FormData ? body : body && JSON.stringify(body) });
  if (!response.ok) throw new Error(`${method} ${path} failed: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function create() {
  const { version } = JSON.parse(await readFile("package.json", "utf8"));
  if (tag !== `v${version}`) throw new Error(`Tag ${tag} does not match package.json version ${version}; bump the version before tagging.`);
  const existing = await fetch(`${api}/releases/tags/${tag}`, { headers });
  if (existing.ok) return console.log(`Release ${tag} already exists.`);
  if (existing.status !== 404) throw new Error(`Looking up release ${tag} failed: ${existing.status} ${await existing.text()}`);
  await call("POST", "/releases", { tag_name: tag, name: `AgentCompany ${version}`, draft: false, prerelease: false });
  console.log(`Created release ${tag}.`);
}

async function upload(dir) {
  const files = (await readdir(dir)).filter((name) => INSTALLER.test(name)).map((name) => join(dir, name));
  if (files.length === 0) throw new Error(`No installers found in ${dir}.`);
  const release = await call("GET", `/releases/tags/${tag}`);
  for (const file of files) {
    const name = basename(file);
    // A re-run replaces the asset instead of failing on the duplicate name.
    const old = release.assets.find((asset) => asset.name === name);
    if (old) await call("DELETE", `/releases/${release.id}/assets/${old.id}`);
    const form = new FormData();
    form.append("attachment", await openAsBlob(file), name);
    await call("POST", `/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, form);
    console.log(`Uploaded ${name}.`);
  }
}

const [command, dir] = process.argv.slice(2);
if (command === "create") await create();
else if (command === "upload") await upload(dir ?? "release");
else throw new Error(`Unknown command ${command}; use create or upload.`);
