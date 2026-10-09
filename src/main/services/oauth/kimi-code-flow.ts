/**
 * Kimi Code (kimi.com plan) OAuth — RFC 8628 device-code flow.
 *
 * Mirrors the official MoonshotAI/kimi-cli implementation: form-encoded
 * requests against auth.kimi.com carrying the X-Msh-* device headers the
 * backend requires, then Bearer access tokens against the coding endpoint.
 */
import { createHash } from "node:crypto";
import { hostname, platform as osPlatform, release as osRelease, userInfo } from "node:os";
import type { OAuthCredentials, OAuthFlow, OAuthLoginCallbacks } from "./oauth-types";
import { httpFailure } from "../provider-http";
import { oauthFetch } from "./oauth-fetch";

// Published public client id of the official Kimi CLI; reused by third-party
// coding agents per Kimi's device-flow integration guidance.
const CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
const OAUTH_HOST = "https://auth.kimi.com";
export const KIMI_CODE_BASE_URL = "https://api.kimi.com/coding/v1";
const TOKEN_EXPIRY_MARGIN_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const DEFAULT_DEVICE_CODE_LIFETIME_SECONDS = 900;

/**
 * Stable per-machine device identity (32 hex chars, matching the CLI's
 * uuid4().hex format). Derived instead of stored so every call site — login,
 * refresh — reports the same device without a new persistence surface.
 */
function kimiDeviceId(): string {
  return createHash("sha256")
    .update(`agentcompany|${hostname()}|${osPlatform()}|${userInfo().username}`)
    .digest("hex")
    .slice(0, 32);
}

function asciiHeaderValue(value: string, fallback: string): string {
  const sanitized = value.replace(/[^\x20-\x7e]/g, "").trim();
  return sanitized || fallback;
}

/** The auth backend rejects requests that omit these device headers. */
function deviceHeaders(): Record<string, string> {
  return {
    "X-Msh-Platform": "agentcompany",
    "X-Msh-Version": "1.0",
    "X-Msh-Device-Name": asciiHeaderValue(hostname(), "unknown"),
    "X-Msh-Device-Model": asciiHeaderValue(osPlatform(), "unknown"),
    "X-Msh-Os-Version": asciiHeaderValue(osRelease(), "unknown"),
    "X-Msh-Device-Id": kimiDeviceId(),
  };
}

async function postForm(path: string, form: Record<string, string>, cancel?: AbortSignal): Promise<{ status: number; data: Record<string, unknown>; response: Response; text: string }> {
  const { response, text } = await oauthFetch(`${OAUTH_HOST}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      ...deviceHeaders(),
    },
    body: new URLSearchParams(form),
  }, cancel);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw httpFailure(`Kimi OAuth endpoint returned a non-JSON response: ${response.status} ${text.slice(0, 200)}`, response, text);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw httpFailure(`Kimi OAuth endpoint returned an unexpected payload: ${response.status}`, response, text);
  }
  return { status: response.status, data: data as Record<string, unknown>, response, text };
}

interface DeviceAuthorization {
  device_code: string;
  user_code: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

async function requestDeviceAuthorization(cancel?: AbortSignal): Promise<DeviceAuthorization> {
  const { status, data } = await postForm("/api/oauth/device_authorization", { client_id: CLIENT_ID }, cancel);
  if (status !== 200) throw new Error(`Kimi device authorization failed: ${status} ${JSON.stringify(data)}`);
  const deviceCode = data.device_code;
  const userCode = data.user_code;
  const verificationUriComplete = data.verification_uri_complete;
  if (typeof deviceCode !== "string" || typeof userCode !== "string" || typeof verificationUriComplete !== "string") {
    throw new Error("Invalid device authorization response from Kimi.");
  }
  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri_complete: verificationUriComplete,
    expires_in: typeof data.expires_in === "number" && data.expires_in > 0 ? data.expires_in : DEFAULT_DEVICE_CODE_LIFETIME_SECONDS,
    interval: typeof data.interval === "number" && data.interval > 0 ? data.interval : DEFAULT_POLL_INTERVAL_SECONDS,
  };
}

function credentialsFromToken(raw: Record<string, unknown>): OAuthCredentials {
  const access = raw.access_token;
  const refresh = raw.refresh_token;
  const expiresIn = raw.expires_in;
  if (typeof access !== "string" || typeof refresh !== "string" || typeof expiresIn !== "number") {
    throw new Error("Kimi token response was missing required fields.");
  }
  return { access, refresh, expires: Date.now() + expiresIn * 1000 - TOKEN_EXPIRY_MARGIN_MS };
}

export type KimiPollDecision =
  | { kind: "token"; credentials: OAuthCredentials }
  | { kind: "pending" }
  | { kind: "expired" }
  | { kind: "error"; message: string };

/** Pure interpreter of a device-token poll response (unit-tested). */
export function interpretKimiPollResponse(status: number, raw: Record<string, unknown>): KimiPollDecision {
  if (status === 200 && typeof raw.access_token === "string") {
    return { kind: "token", credentials: credentialsFromToken(raw) };
  }
  const error = typeof raw.error === "string" ? raw.error : "";
  if (error === "expired_token") return { kind: "expired" };
  if (error === "access_denied") {
    const description = typeof raw.error_description === "string" && raw.error_description ? `: ${raw.error_description}` : "";
    return { kind: "error", message: `Kimi sign-in was denied${description}` };
  }
  // The reference CLI keeps polling on every other status (authorization_pending,
  // slow_down, transient 5xx); the device-code deadline bounds the wait.
  return { kind: "pending" };
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Login cancelled"));
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new Error("Login cancelled"));
      },
      { once: true },
    );
  });
}

async function pollForToken(device: DeviceAuthorization, signal?: AbortSignal): Promise<OAuthCredentials> {
  const deadline = Date.now() + device.expires_in * 1000;
  const intervalMs = Math.max(1000, device.interval * 1000);
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Login cancelled");
    await abortableSleep(Math.min(intervalMs, deadline - Date.now()), signal);
    const { status, data } = await postForm("/api/oauth/token", {
      client_id: CLIENT_ID,
      device_code: device.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }, signal);
    const decision = interpretKimiPollResponse(status, data);
    if (decision.kind === "token") return decision.credentials;
    if (decision.kind === "expired") throw new Error("Kimi device code expired. Please try signing in again.");
    if (decision.kind === "error") throw new Error(decision.message);
  }
  throw new Error("Kimi device flow timed out. Please try signing in again.");
}

/** Refresh an expired Kimi Code access token (they live ~15 minutes). */
export async function refreshKimiCode(refreshToken: string): Promise<OAuthCredentials> {
  const { status, data, response, text } = await postForm("/api/oauth/token", {
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  if (status !== 200) throw httpFailure(`Kimi token refresh failed: ${status} ${JSON.stringify(data)}`, response, text);
  return credentialsFromToken(data);
}

export const kimiCodeFlow: OAuthFlow = {
  providerKey: "kimi-code",
  async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
    const device = await requestDeviceAuthorization(callbacks.signal);
    callbacks.onAuth({
      url: device.verification_uri_complete,
      userCode: device.user_code,
    });
    return pollForToken(device, callbacks.signal);
  },
};
