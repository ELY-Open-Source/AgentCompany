const TRUSTED_EXTERNAL_HOSTS = new Set([
  "github.com",
  "www.github.com",
  "agentcompany.pages.dev",
  "claude.ai",
  "www.electronjs.org",
  "www.electron.build",
]);

export type ExternalUrlDecision =
  | { kind: "trusted"; url: string; host: string }
  | { kind: "confirm"; url: string; host: string }
  | { kind: "blocked"; reason: string };

export function normalizeExternalHttpUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error("External URL is required.");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("External URL must be absolute.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("External URL protocol must be http or https.");
  }
  if (!parsed.hostname) {
    throw new Error("External URL host is required.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("External URL credentials are not allowed.");
  }
  return parsed.toString();
}

export function classifyExternalUrl(rawUrl: string): ExternalUrlDecision {
  let normalized: string;
  try {
    normalized = normalizeExternalHttpUrl(rawUrl);
  } catch (error) {
    return {
      kind: "blocked",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const parsed = new URL(normalized);
  const host = parsed.hostname.toLowerCase();
  if (TRUSTED_EXTERNAL_HOSTS.has(host)) {
    return { kind: "trusted", url: normalized, host };
  }
  return { kind: "confirm", url: normalized, host };
}
