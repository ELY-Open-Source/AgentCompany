import { net } from "electron";
import { currentRunSignal, stopReasonOf } from "../run-control";

const BASE_URL = "https://backend.composio.dev/api/v3";

export interface ComposioToolSchema {
  name: string;
  description: string;
  toolkitSlug: string | null;
  /** The action's input JSON Schema exactly as Composio validates it ($defs, combinations and limits kept). */
  parameters: Record<string, unknown>;
}

export interface ComposioAuthConfigSummary {
  id: string;
  toolkitSlug: string;
  authScheme: string;
  status: string;
}

export interface ComposioConnectedAccount {
  id: string;
  toolkitSlug: string;
  status: string;
  authConfigId: string;
  createdAt: string;
}

/** Composio answers 200 for business failures too; only `successful` tells them apart. */
export type ComposioToolExecutionResult = { successful: true; data: unknown } | { successful: false; error: string };

const MAX_RESPONSE_BYTES = 2_000_000;
const REQUEST_TIMEOUT_MS = 30_000;
const EXECUTE_TIMEOUT_MS = 120_000;

export class ComposioClient {
  constructor(private readonly apiKey: string) {}

  /** Every auth config in the Composio project — the connector catalog. */
  async listAuthConfigs(): Promise<ComposioAuthConfigSummary[]> {
    const configs: ComposioAuthConfigSummary[] = [];
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams({ limit: "100" });
      if (cursor) params.set("cursor", cursor);
      const response = await this.request("GET", `${BASE_URL}/auth_configs?${params.toString()}`);
      const items = Array.isArray(response.items) ? response.items as Array<Record<string, unknown>> : [];
      for (const item of items) {
        const toolkit = (item.toolkit ?? {}) as Record<string, unknown>;
        configs.push({
          id: String(item.id ?? ""),
          toolkitSlug: String(toolkit.slug ?? "").toLowerCase(),
          authScheme: String(item.auth_scheme ?? ""),
          status: String(item.status ?? ""),
        });
      }
      cursor = typeof response.next_cursor === "string" && response.next_cursor ? response.next_cursor : null;
      if (items.length === 0) break;
    } while (cursor);
    return configs;
  }

  /** Every tool of each toolkit, page by page; an agent's actions must not depend on where a list happens to stop. */
  async getTools(toolkits: string[]): Promise<ComposioToolSchema[]> {
    const all: ComposioToolSchema[] = [];
    for (const toolkit of toolkits) {
      let cursor: string | null = null;
      do {
        const params = new URLSearchParams({ toolkit_slug: toolkit, limit: "100" });
        if (cursor) params.set("cursor", cursor);
        const response = await this.request("GET", `${BASE_URL}/tools?${params.toString()}`);
        const items = Array.isArray(response.items) ? response.items as Array<Record<string, unknown>> : [];
        all.push(...items.map(normalizeToolSchema));
        cursor = typeof response.next_cursor === "string" && response.next_cursor ? response.next_cursor : null;
        if (items.length === 0) break;
      } while (cursor);
    }
    return all;
  }

  /**
   * Starts a connection for a user; the redirect URL completes it in the
   * browser. Composio-managed auth configs only accept the link flow —
   * POST /connected_accounts is rejected for them with a 400.
   */
  async createConnectedAccount(input: { authConfigId: string; userId: string }): Promise<{
    id: string;
    redirectUrl: string | null;
  }> {
    const response = await this.request("POST", `${BASE_URL}/connected_accounts/link`, {
      auth_config_id: input.authConfigId,
      user_id: input.userId,
    });
    return {
      id: String(response.connected_account_id ?? ""),
      redirectUrl: typeof response.redirect_url === "string" ? response.redirect_url : null,
    };
  }

  async listConnectedAccounts(userId: string): Promise<ComposioConnectedAccount[]> {
    const accounts: ComposioConnectedAccount[] = [];
    let cursor: string | null = null;
    do {
      const params = new URLSearchParams({ user_ids: userId, limit: "100" });
      if (cursor) params.set("cursor", cursor);
      const response = await this.request("GET", `${BASE_URL}/connected_accounts?${params.toString()}`);
      const items = Array.isArray(response.items) ? response.items as Array<Record<string, unknown>> : [];
      for (const item of items) {
        const toolkit = (item.toolkit ?? {}) as Record<string, unknown>;
        const authConfig = (item.auth_config ?? {}) as Record<string, unknown>;
        accounts.push({
          id: String(item.id ?? ""),
          toolkitSlug: String(toolkit.slug ?? "").toLowerCase(),
          status: String(item.status ?? ""),
          authConfigId: String(authConfig.id ?? ""),
          createdAt: String(item.created_at ?? ""),
        });
      }
      cursor = typeof response.next_cursor === "string" && response.next_cursor ? response.next_cursor : null;
      if (items.length === 0) break;
    } while (cursor);
    return accounts;
  }

  /** Idempotent: an account already gone in Composio (404) counts as deleted. */
  async deleteConnectedAccount(accountId: string): Promise<void> {
    await this.request("DELETE", `${BASE_URL}/connected_accounts/${encodeURIComponent(accountId)}`, undefined, {
      tolerateNotFound: true,
    });
  }

  async executeTool(input: {
    toolName: string;
    arguments: Record<string, unknown>;
    userId: string;
    connectedAccountId?: string;
  }): Promise<ComposioToolExecutionResult> {
    const url = `${BASE_URL}/tools/execute/${encodeURIComponent(input.toolName)}`;
    const body: Record<string, unknown> = {
      user_id: input.userId,
      arguments: input.arguments,
    };
    if (input.connectedAccountId) body.connected_account_id = input.connectedAccountId;
    const response = await this.request("POST", url, body, { timeoutMs: EXECUTE_TIMEOUT_MS });
    if (typeof response.successful !== "boolean") throw new Error(`Composio returned no execution status for ${input.toolName}.`);
    if (response.successful) return { successful: true, data: response.data };
    return { successful: false, error: typeof response.error === "string" && response.error.trim() ? response.error.trim() : "Composio gave no reason." };
  }

  private async request(
    method: string,
    url: string,
    body?: Record<string, unknown>,
    options?: { tolerateNotFound?: boolean; timeoutMs?: number },
  ): Promise<Record<string, unknown>> {
    const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const runSignal = currentRunSignal();
      if (runSignal?.aborted) {
        reject(new Error(stopReasonOf(runSignal)));
        return;
      }
      const request = net.request({ method, url });
      let settled = false;
      const finish = (error: Error | null, value: Record<string, unknown> = {}) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        runSignal?.removeEventListener("abort", onStop);
        if (!error) {
          resolve(value);
          return;
        }
        request.abort();
        reject(error);
      };
      const onStop = () => finish(new Error(stopReasonOf(runSignal!)));
      const timer = setTimeout(() => {
        console.warn(`[connectors] ${method} ${url} gave no answer within ${timeoutMs / 1000}s`);
        finish(new Error(`Composio API ${method} ${url} gave no answer within ${timeoutMs / 1000}s.`));
      }, timeoutMs);
      runSignal?.addEventListener("abort", onStop, { once: true });
      request.setHeader("x-api-key", this.apiKey);
      request.setHeader("Accept", "application/json");
      if (body) request.setHeader("Content-Type", "application/json");

      const chunks: Buffer[] = [];
      let received = 0;
      request.on("response", (response) => {
        response.on("data", (chunk) => {
          if (settled) return;
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) {
            finish(new Error(`Composio API ${method} ${url} returned more than ${MAX_RESPONSE_BYTES} bytes; ask for fewer items or narrower fields.`));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (settled) return;
          const responseData = Buffer.concat(chunks).toString("utf8");
          if (response.statusCode === 404 && options?.tolerateNotFound) {
            finish(null);
            return;
          }
          if (response.statusCode && response.statusCode >= 400) {
            finish(new Error(`Composio API ${method} ${url} returned ${response.statusCode}: ${responseData.slice(0, 200)}`));
            return;
          }
          try {
            finish(null, JSON.parse(responseData) as Record<string, unknown>);
          } catch {
            finish(new Error(`Composio API returned non-JSON response: ${responseData.slice(0, 200)}`));
          }
        });
        response.on("error", (error) => finish(error));
      });
      request.on("error", (error) => finish(error));
      if (body) request.write(JSON.stringify(body));
      request.end();
    });
  }
}

function normalizeToolSchema(raw: Record<string, unknown>): ComposioToolSchema {
  const name = String(raw.slug ?? raw.name ?? "");
  const field = ["input_parameters", "parameters", "inputSchema"].find((key) => key in raw);
  const params = field === undefined ? undefined : raw[field];
  // An action without an input schema takes no input; anything else must be a schema object, passed on unchanged.
  if (params !== undefined && (typeof params !== "object" || params === null || Array.isArray(params))) throw new Error(`Composio action ${name} has an input schema that is not an object.`);
  const toolkit = (raw.toolkit ?? {}) as Record<string, unknown>;
  return {
    name,
    description: String(raw.description ?? "").slice(0, 300),
    toolkitSlug: typeof toolkit.slug === "string" ? toolkit.slug : null,
    parameters: params === undefined ? { type: "object", properties: {} } : params as Record<string, unknown>,
  };
}
