export const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
export const MAX_EXCERPT_BYTES = 32 * 1024;

const SENSITIVE_ENV_KEY = /(key|token|secret|password|passwd|authorization|cookie)/i;

export function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function parseJson(value: string): Record<string, unknown> | null {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function appendWithCap(prev: string, chunk: string, cap = MAX_CAPTURE_BYTES) {
  const combined = prev + chunk;
  return combined.length > cap ? combined.slice(combined.length - cap) : combined;
}

export function resolvePathValue(obj: Record<string, unknown>, dottedPath: string) {
  const parts = dottedPath.split(".");
  let cursor: unknown = obj;

  for (const part of parts) {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) {
      return "";
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }

  if (cursor === null || cursor === undefined) return "";
  if (typeof cursor === "string") return cursor;
  if (typeof cursor === "number" || typeof cursor === "boolean") return String(cursor);

  try {
    return JSON.stringify(cursor);
  } catch {
    return "";
  }
}

export function renderTemplate(template: string, data: Record<string, unknown>) {
  return template.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_, path) => resolvePathValue(data, path));
}

/**
 * Remove flags from `extraArgs` that the adapter will already add itself.
 * Handles both `--flag value` pairs and `--flag=value` forms.
 * This prevents duplicate/conflicting CLI arguments when users have shell
 * aliases or wrapper functions that inject the same flags.
 */
export function filterConflictingArgs(extraArgs: string[], adapterFlags: string[]): string[] {
  const flagSet = new Set(adapterFlags.map((f) => f.replace(/=.*$/, "")));
  const filtered: string[] = [];
  for (let i = 0; i < extraArgs.length; i++) {
    const arg = extraArgs[i];
    const bareFlag = arg.replace(/=.*$/, "");
    if (flagSet.has(bareFlag)) {
      // Skip this flag and its value if the value is a separate argument
      if (!arg.includes("=") && i + 1 < extraArgs.length && !extraArgs[i + 1].startsWith("-")) {
        i++; // skip the value argument too
      }
      continue;
    }
    filtered.push(arg);
  }
  return filtered;
}

export function redactEnvForLogs(env: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    redacted[key] = SENSITIVE_ENV_KEY.test(key) ? "***REDACTED***" : value;
  }
  return redacted;
}

export function buildAgentCompanyEnv(agent: { id: string; companyId: string }): Record<string, string> {
  const resolveHostForUrl = (rawHost: string): string => {
    const host = rawHost.trim();
    if (!host || host === "0.0.0.0" || host === "::") return "localhost";
    if (host.includes(":") && !host.startsWith("[") && !host.endsWith("]")) return `[${host}]`;
    return host;
  };
  const vars: Record<string, string> = {
    AGENT_COMPANY_AGENT_ID: agent.id,
    AGENT_COMPANY_COMPANY_ID: agent.companyId,
  };
  const runtimeHost = resolveHostForUrl(
    process.env.AGENT_COMPANY_LISTEN_HOST ?? process.env.HOST ?? "localhost",
  );
  const runtimePort = process.env.AGENT_COMPANY_LISTEN_PORT ?? process.env.PORT ?? "3100";
  const apiUrl = process.env.AGENT_COMPANY_API_URL ?? `http://${runtimeHost}:${runtimePort}`;
  vars.AGENT_COMPANY_API_URL = apiUrl;
  return vars;
}

export function defaultPathForPlatform() {
  if (process.platform === "win32") {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
    const appData = process.env.APPDATA ?? (home ? `${home}\\AppData\\Roaming` : "");
    const localAppData = process.env.LOCALAPPDATA ?? (home ? `${home}\\AppData\\Local` : "");
    const parts = [
      "C:\\Windows\\System32",
      "C:\\Windows",
      "C:\\Windows\\System32\\Wbem",
      appData ? `${appData}\\npm` : "",
      localAppData ? `${localAppData}\\pnpm` : "",
      home ? `${home}\\.local\\bin` : "",
      home ? `${home}\\.cargo\\bin` : "",
      "C:\\Program Files\\nodejs",
    ].filter(Boolean);
    return parts.join(";");
  }
  return "/usr/local/bin:/opt/homebrew/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin";
}
