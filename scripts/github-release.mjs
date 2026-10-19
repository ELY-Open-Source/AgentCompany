// GitHub release for the pushed tag: `create` checks the tag against package.json and opens the release; `upload` attaches installers.
import { openAsBlob } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

const INSTALLER = /\.(exe|dmg|zip|AppImage|deb)$/;

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

const api = `${env("GITHUB_API_URL")}/repos/${env("GITHUB_REPOSITORY")}`;
const tag = env("GITHUB_REF_NAME");
const headers = { Authorization: `Bearer ${env("GITHUB_TOKEN")}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };

async function call(method, url, body, contentType = "application/json") {
  const response = await fetch(url.startsWith("https://") ? url : `${api}${url}`, { method, headers: body ? { ...headers, "Content-Type": contentType } : headers, body: body instanceof Blob ? body : body && JSON.stringify(body) });
  if (!response.ok) throw new Error(`${method} ${url} failed: ${response.status} ${await response.text()}`);
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
  // upload_url is a URI template ending in {?name,label}.
  const uploadUrl = release.upload_url.replace(/\{.*\}$/, "");
  for (const file of files) {
    const name = basename(file);
    // A re-run replaces the asset instead of failing on the duplicate name.
    const old = release.assets.find((asset) => asset.name === name);
    if (old) await call("DELETE", `/releases/assets/${old.id}`);
    await call("POST", `${uploadUrl}?name=${encodeURIComponent(name)}`, await openAsBlob(file), "application/octet-stream");
    console.log(`Uploaded ${name}.`);
  }
}

const [command, dir] = process.argv.slice(2);
if (command === "create") await create();
else if (command === "upload") await upload(dir ?? "release");
else throw new Error(`Unknown command ${command}; use create or upload.`);
