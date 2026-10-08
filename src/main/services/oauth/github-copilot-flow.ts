/**
 * GitHub Copilot OAuth — device-code flow.
 *
 * Ported from the reference implementation in @mariozechner/pi-ai. The device
 * flow obtains a GitHub access token, then exchanges it for a Copilot token.
 */
import { listProviderModels } from "../../../shared/provider-models";
import type { OAuthCredentials, OAuthFlow, OAuthLoginCallbacks } from "./oauth-types";
import { httpFailure } from "../provider-http";

// Decoded from the published GitHub Copilot client id used by the official CLI.
const CLIENT_ID = "Iv1.b507a08c87ecfe98";
export const COPILOT_HEADERS = {
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Copilot-Integration-Id": "vscode-chat",
} as const;
const INITIAL_POLL_INTERVAL_MULTIPLIER = 1.2;
const SLOW_DOWN_POLL_INTERVAL_MULTIPLIER = 1.4;

interface CopilotUrls {
  deviceCodeUrl: string;
  accessTokenUrl: string;
  copilotTokenUrl: string;
}

function normalizeDomain(input: string | null | undefined): string | null {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return null;
  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    return url.hostname;
  } catch {
    return null;
  }
}

function getUrls(domain: string): CopilotUrls {
  return {
    deviceCodeUrl: `https://${domain}/login/device/code`,
    accessTokenUrl: `https://${domain}/login/oauth/access_token`,
    copilotTokenUrl: `https://api.${domain}/copilot_internal/v2/token`,
  };
}

async function fetchJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw httpFailure(`${response.status} ${response.statusText}: ${text}`, response, text);
  }
  return (await response.json()) as Record<string, unknown>;
}

interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
}

async function startDeviceFlow(domain: string): Promise<DeviceCode> {
  const data = await fetchJson(getUrls(domain).deviceCodeUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": COPILOT_HEADERS["User-Agent"],
    },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: "read:user" }),
  });
  const deviceCode = data.device_code;
  const userCode = data.user_code;
  const verificationUri = data.verification_uri;
  const interval = data.interval;
  const expiresIn = data.expires_in;
  if (
    typeof deviceCode !== "string" ||
    typeof userCode !== "string" ||
    typeof verificationUri !== "string" ||
    typeof interval !== "number" ||
    typeof expiresIn !== "number"
  ) {
    throw new Error("Invalid device code response from GitHub.");
  }
  return { device_code: deviceCode, user_code: userCode, verification_uri: verificationUri, interval, expires_in: expiresIn };
}

export type PollDecision =
  | { kind: "token"; accessToken: string }
  | { kind: "pending" }
  | { kind: "slow_down"; intervalSeconds: number | null }
  | { kind: "error"; message: string };

/** Pure interpreter of a device-token poll response (unit-tested). */
export function interpretPollResponse(raw: Record<string, unknown>): PollDecision {
  if (typeof raw.access_token === "string") return { kind: "token", accessToken: raw.access_token };
  if (typeof raw.error === "string") {
    if (raw.error === "authorization_pending") return { kind: "pending" };
    if (raw.error === "slow_down") {
      return { kind: "slow_down", intervalSeconds: typeof raw.interval === "number" ? raw.interval : null };
    }
    const description = typeof raw.error_description === "string" ? `: ${raw.error_description}` : "";
    return { kind: "error", message: `Device flow failed: ${raw.error}${description}` };
  }
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

async function pollForGitHubAccessToken(domain: string, device: DeviceCode, signal?: AbortSignal): Promise<string> {
  const { accessTokenUrl } = getUrls(domain);
  const deadline = Date.now() + device.expires_in * 1000;
  let intervalMs = Math.max(1000, Math.floor(device.interval * 1000));
  let intervalMultiplier = INITIAL_POLL_INTERVAL_MULTIPLIER;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Login cancelled");
    const remainingMs = deadline - Date.now();
    const waitMs = Math.min(Math.ceil(intervalMs * intervalMultiplier), remainingMs);
    await abortableSleep(waitMs, signal);
    const raw = await fetchJson(accessTokenUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": COPILOT_HEADERS["User-Agent"],
      },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        device_code: device.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const decision = interpretPollResponse(raw);
    if (decision.kind === "token") return decision.accessToken;
    if (decision.kind === "error") throw new Error(decision.message);
    if (decision.kind === "slow_down") {
      intervalMs = decision.intervalSeconds && decision.intervalSeconds > 0 ? decision.intervalSeconds * 1000 : Math.max(1000, intervalMs + 5000);
      intervalMultiplier = SLOW_DOWN_POLL_INTERVAL_MULTIPLIER;
    }
  }
  throw new Error("Device flow timed out. Please try signing in again.");
}

export async function refreshGitHubCopilotToken(githubToken: string, enterpriseDomain?: string | null): Promise<OAuthCredentials> {
  const domain = enterpriseDomain || "github.com";
  const raw = await fetchJson(getUrls(domain).copilotTokenUrl, {
    headers: { Accept: "application/json", Authorization: `Bearer ${githubToken}`, ...COPILOT_HEADERS },
  });
  const token = raw.token;
  const expiresAt = raw.expires_at;
  if (typeof token !== "string" || typeof expiresAt !== "number") {
    throw new Error("Invalid Copilot token response.");
  }
  return {
    access: token,
    refresh: githubToken,
    expires: expiresAt * 1000 - 5 * 60 * 1000,
    enterpriseUrl: enterpriseDomain ?? null,
  };
}

export function copilotBaseUrl(token: string, enterpriseDomain?: string | null): string {
  const match = token.match(/proxy-ep=([^;]+)/);
  if (match) return `https://${match[1].replace(/^proxy\./, "api.")}`;
  if (enterpriseDomain) return `https://copilot-api.${enterpriseDomain}`;
  return "https://api.individual.githubcopilot.com";
}

/** Best-effort model policy enablement, matching the official client behaviour. */
async function enableCopilotModels(token: string, enterpriseDomain?: string | null): Promise<void> {
  const baseUrl = copilotBaseUrl(token, enterpriseDomain);
  await Promise.all(
    listProviderModels("github-copilot").map(async (model) => {
      try {
        await fetch(`${baseUrl}/models/${model.id}/policy`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...COPILOT_HEADERS,
            "openai-intent": "chat-policy",
            "x-interaction-type": "chat-policy",
          },
          body: JSON.stringify({ state: "enabled" }),
        });
      } catch {
        // Per-model enablement is advisory; the model may already be enabled.
      }
    }),
  );
}

export const githubCopilotFlow: OAuthFlow = {
  providerKey: "github-copilot",
  async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
    const enterpriseDomain = normalizeDomain(callbacks.enterpriseDomain);
    const domain = enterpriseDomain ?? "github.com";
    const device = await startDeviceFlow(domain);
    callbacks.onAuth({
      url: device.verification_uri,
      instructions: `Enter code ${device.user_code} at ${device.verification_uri}`,
    });
    const githubToken = await pollForGitHubAccessToken(domain, device, callbacks.signal);
    const credentials = await refreshGitHubCopilotToken(githubToken, enterpriseDomain ?? undefined);
    callbacks.onProgress?.("Enabling Copilot models");
    await enableCopilotModels(credentials.access, enterpriseDomain ?? undefined);
    return credentials;
  },
};
