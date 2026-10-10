import {
  DOWNLOAD_DEDUP_WINDOW_MS,
  getDownloadAsset,
  isAllowedDownloadUrl,
} from "../../lib/downloads";
import type { CounterDatabase, PagesHandler } from "../types";

interface Env {
  DOWNLOAD_COUNTER_DB: CounterDatabase;
  DOWNLOAD_COUNTER_SALT: string;
}

function getClientIp(request: Request) {
  const cfConnectingIp = request.headers.get("CF-Connecting-IP")?.trim();
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  const forwardedFor = request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  return forwardedFor || null;
}

function getWindowKey(now = Date.now()) {
  return Math.floor(now / DOWNLOAD_DEDUP_WINDOW_MS);
}

async function sha256Hex(input: string) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function countUniqueDownload(db: CounterDatabase, request: Request, assetId: string, salt: string) {
  const clientIp = getClientIp(request);
  if (!clientIp) {
    return;
  }

  const ipHash = await sha256Hex(`${salt}:${clientIp}`);
  const windowKey = getWindowKey();

  await db
    .prepare(`
      INSERT OR IGNORE INTO unique_download_windows (
        ip_hash,
        window_key,
        first_asset_id,
        created_at
      ) VALUES (?, ?, ?, datetime('now'))
    `)
    .bind(ipHash, windowKey, assetId)
    .run();
}

export const onRequestGet: PagesHandler<Env> = async (context) => {
  if (!context.env.DOWNLOAD_COUNTER_DB) {
    throw new Error("DOWNLOAD_COUNTER_DB binding is missing.");
  }
  if (!context.env.DOWNLOAD_COUNTER_SALT) {
    throw new Error("DOWNLOAD_COUNTER_SALT variable is missing.");
  }

  const url = new URL(context.request.url);
  const assetId = url.searchParams.get("asset")?.trim();
  if (!assetId) {
    return new Response("Missing asset parameter.", { status: 400 });
  }

  const asset = getDownloadAsset(assetId);
  if (!asset) {
    return new Response("Unknown asset.", { status: 404 });
  }
  if (!isAllowedDownloadUrl(asset.href)) {
    throw new Error(`Asset ${asset.id} points outside the release host: ${asset.href}`);
  }

  await countUniqueDownload(
    context.env.DOWNLOAD_COUNTER_DB,
    context.request,
    asset.id,
    context.env.DOWNLOAD_COUNTER_SALT,
  );

  return Response.redirect(asset.href, 302);
};
