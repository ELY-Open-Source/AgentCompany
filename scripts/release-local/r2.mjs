import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const defaultBucket = "agentcompany-updates";
const defaultPrefix = "AC";
const ignoredReleaseFiles = new Set(["builder-debug.yml"]);

function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, "");
}

function normalizePathSegment(pathValue) {
  return pathValue.replace(/^\/+|\/+$/g, "");
}

function guessContentType(fileName) {
  if (fileName.endsWith(".yml")) return "text/yaml; charset=utf-8";
  if (fileName.endsWith(".blockmap")) return "application/octet-stream";
  if (fileName.endsWith(".zip")) return "application/zip";
  if (fileName.endsWith(".dmg")) return "application/x-apple-diskimage";
  if (fileName.endsWith(".exe")) return "application/vnd.microsoft.portable-executable";
  if (fileName.endsWith(".AppImage")) return "application/octet-stream";
  if (fileName.endsWith(".deb")) return "application/vnd.debian.binary-package";
  if (fileName.endsWith(".rpm")) return "application/x-rpm";
  if (fileName.endsWith(".snap")) return "application/vnd.snap";
  return "application/octet-stream";
}

async function runWrangler(args, cwd, capture = false) {
  return await new Promise((resolve, reject) => {
    const child = spawn("npx", ["wrangler", ...args], {
      cwd,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || stdout || `wrangler ${args.join(" ")} failed with exit code ${code ?? 1}`));
    });
  });
}

function resolveUpdateUrl(publicBaseUrl, releasePrefix) {
  const baseUrl = normalizeBaseUrl(publicBaseUrl);
  const prefix = normalizePathSegment(releasePrefix);
  return prefix ? `${baseUrl}/${prefix}` : baseUrl;
}

export async function prepareR2ReleaseHost({ rootDir }) {
  const prefix = normalizePathSegment(process.env.AGENTCOMPANY_RELEASE_PREFIX?.trim() || defaultPrefix);
  const whoami = JSON.parse((await runWrangler(["whoami", "--json"], rootDir, true)).stdout);
  const accountId = process.env.R2_ACCOUNT_ID?.trim()
    || process.env.AGENTCOMPANY_R2_ACCOUNT_ID?.trim()
    || whoami.accounts?.[0]?.id;
  if (!accountId) {
    throw new Error("Unable to resolve Cloudflare account ID from wrangler.");
  }

  const bucket = process.env.R2_BUCKET?.trim()
    || process.env.AGENTCOMPANY_R2_BUCKET?.trim()
    || defaultBucket;

  try {
    await runWrangler(["r2", "bucket", "info", bucket, "--json"], rootDir, true);
  } catch (error) {
    if (!String(error).includes("does not exist")) {
      throw error;
    }
    await runWrangler(["r2", "bucket", "create", bucket], rootDir, false);
  }

  let publicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.trim()
    || process.env.AGENTCOMPANY_R2_PUBLIC_URL?.trim()
    || "";

  if (!publicBaseUrl) {
    const devUrlState = await runWrangler(["r2", "bucket", "dev-url", "get", bucket], rootDir, true)
      .then((result) => result.stdout)
      .catch(() => "");
    if (!devUrlState.includes("https://")) {
      await runWrangler(["r2", "bucket", "dev-url", "enable", bucket], rootDir, false);
    }
    const enabledOutput = (await runWrangler(["r2", "bucket", "dev-url", "get", bucket], rootDir, true)).stdout;
    const match = enabledOutput.match(/https:\/\/[^\s']+\.r2\.dev/);
    if (!match) {
      throw new Error("Unable to resolve R2 public dev URL from wrangler.");
    }
    publicBaseUrl = match[0];
  }

  process.env.R2_ACCOUNT_ID = accountId;
  process.env.AGENTCOMPANY_R2_ACCOUNT_ID = accountId;
  process.env.R2_BUCKET = bucket;
  process.env.AGENTCOMPANY_R2_BUCKET = bucket;
  process.env.R2_PUBLIC_BASE_URL = publicBaseUrl;
  process.env.AGENTCOMPANY_R2_PUBLIC_URL = publicBaseUrl;
  process.env.AGENTCOMPANY_RELEASE_PREFIX = prefix;
  process.env.AGENTCOMPANY_R2_PATH = prefix;
  process.env.AGENTCOMPANY_UPDATE_URL = process.env.AGENTCOMPANY_UPDATE_URL?.trim()
    || resolveUpdateUrl(publicBaseUrl, prefix);

  return {
    accountId,
    bucket,
    publicBaseUrl,
    releasePrefix: prefix,
    updateUrl: process.env.AGENTCOMPANY_UPDATE_URL,
  };
}

export async function uploadReleaseFiles({ rootDir, releaseDir, bucket, releasePrefix }) {
  const files = (await readdir(releaseDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && !ignoredReleaseFiles.has(entry.name))
    .map((entry) => entry.name);

  for (const fileName of files) {
    const objectPath = `${bucket}/${normalizePathSegment(releasePrefix)}/${fileName}`;
    const filePath = join(releaseDir, fileName);
    const args = [
      "r2", "object", "put", objectPath,
      "--remote",
      "--file", filePath,
      "--content-type", guessContentType(fileName),
      "--cache-control", fileName.endsWith(".yml") ? "no-cache" : "public, max-age=31536000, immutable",
    ];
    await runWrangler(args, rootDir, false);
  }
}
