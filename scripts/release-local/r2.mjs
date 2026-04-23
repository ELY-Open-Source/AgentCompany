import { readdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

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

function createS3ClientForLargeUploads() {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const endpoint = process.env.R2_S3_ENDPOINT?.trim()
    || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com` : "");
  if (!accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error(
      "Large file (>290 MiB) requires R2 S3 credentials. Set R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_S3_ENDPOINT (or R2_ACCOUNT_ID) in .env.release.local.",
    );
  }
  return new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: false,
  });
}

async function uploadViaS3Multipart({ bucket, key, filePath, fileName }) {
  const client = createS3ClientForLargeUploads();
  const upload = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: createReadStream(filePath),
      ContentType: guessContentType(fileName),
      CacheControl: fileName.endsWith(".yml") ? "no-cache" : "public, max-age=31536000, immutable",
    },
    partSize: 64 * 1024 * 1024,
    queueSize: 4,
  });
  upload.on("httpUploadProgress", (p) => {
    if (p.loaded && p.total) {
      process.stdout.write(`\r[s3-multipart] ${key} ${(p.loaded / p.total * 100).toFixed(1)}%`);
    }
  });
  await upload.done();
  process.stdout.write(`\n[s3-multipart] ${key} uploaded\n`);
}

export function classifyReleaseArtifact(fileName) {
  if (fileName === "latest-mac.yml") return "mac";
  if (/\.dmg(\.blockmap)?$/.test(fileName)) return "mac";
  if (/-mac\.zip(\.blockmap)?$/.test(fileName)) return "mac";
  if (fileName === "latest.yml") return "win";
  if (/\.exe(\.blockmap)?$/.test(fileName)) return "win";
  if (fileName === "latest-linux.yml") return "linux";
  if (/\.(AppImage|deb|rpm|snap)$/.test(fileName)) return "linux";
  return "other";
}

export async function purgeReleasePrefix({ bucket, releasePrefix, keep }) {
  const client = createS3ClientForLargeUploads();
  const prefix = `${normalizePathSegment(releasePrefix)}/`;
  const keepClass = new Set(Array.isArray(keep) ? keep : []);
  let continuationToken;
  let total = 0;
  let skipped = 0;
  do {
    const list = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));
    const candidates = list.Contents ?? [];
    const toDelete = [];
    for (const obj of candidates) {
      const baseName = obj.Key.slice(prefix.length);
      if (keepClass.has(classifyReleaseArtifact(baseName))) {
        skipped += 1;
        continue;
      }
      toDelete.push({ Key: obj.Key });
    }
    if (toDelete.length > 0) {
      await client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: toDelete, Quiet: true },
      }));
      total += toDelete.length;
    }
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);
  console.log(
    `[r2-purge] deleted ${total} object(s) under ${bucket}/${prefix}` +
    (skipped > 0 ? ` (kept ${skipped} in classes: ${[...keepClass].join(",")})` : ""),
  );
}

export async function uploadReleaseFiles({ rootDir, releaseDir, bucket, releasePrefix }) {
  const files = (await readdir(releaseDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && !ignoredReleaseFiles.has(entry.name))
    .map((entry) => entry.name);

  for (const fileName of files) {
    const key = `${normalizePathSegment(releasePrefix)}/${fileName}`;
    const filePath = join(releaseDir, fileName);
    // Always use the S3 multipart path: wrangler's OAuth token commonly lacks
    // the r2 scope, which returns 401 on `r2 object put`. The S3 credentials
    // (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY) bypass that mismatch and
    // handle every file size uniformly. `rootDir` is kept in the signature
    // for call-site compatibility even though the S3 path does not need it.
    void rootDir;
    await uploadViaS3Multipart({ bucket, key, filePath, fileName });
  }
}
