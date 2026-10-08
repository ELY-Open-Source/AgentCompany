import { net } from "electron";
import { currentRunSignal, RUN_STOPPED_MESSAGE, runStopReason } from "../run-control";

const BASE_URL = "https://backend.composio.dev/api/v3";

export interface ComposioToolSchema {
  name: string;
  description: string;
  toolkitSlug: string | null;
  parameters: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
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

export interface ComposioToolExecutionResult {
  data: Record<string, unknown>;
  error: string | null;
}

const MAX_RESPONSE_BYTES = 2_000_000;

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

  async getTools(toolkits: string[]): Promise<ComposioToolSchema[]> {
    const all: ComposioToolSchema[] = [];
    for (const toolkit of toolkits) {
      const params = new URLSearchParams({ toolkit_slug: toolkit, limit: "20" });
      const url = `${BASE_URL}/tools?${params.toString()}`;
      const response = await this.request("GET", url);
      if (Array.isArray(response.items)) {
        all.push(...(response.items as Array<Record<string, unknown>>).map(normalizeToolSchema));
      }
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
    const response = await this.request("POST", url, body);
    return {
      data: typeof response === "object" && response !== null ? response as Record<string, unknown> : {},
      error: null,
    };
  }

  private async request(
    method: string,
    url: string,
    body?: Record<string, unknown>,
    options?: { tolerateNotFound?: boolean },
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const request = net.request({ method, url });
      const runSignal = currentRunSignal();
      if (runSignal?.aborted) {
        reject(new Error(runStopReason() ?? RUN_STOPPED_MESSAGE));
        return;
      }
      runSignal?.addEventListener("abort", () => {
        request.abort();
        reject(new Error(runStopReason() ?? RUN_STOPPED_MESSAGE));
      }, { once: true });
      request.setHeader("x-api-key", this.apiKey);
      request.setHeader("Accept", "application/json");
      if (body) request.setHeader("Content-Type", "application/json");

      const chunks: Buffer[] = [];
      let received = 0;
      let aborted = false;
      request.on("response", (response) => {
        response.on("data", (chunk) => {
          if (aborted) return;
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) {
            aborted = true;
            request.abort();
            reject(new Error(`Composio API ${method} ${url} returned more than ${MAX_RESPONSE_BYTES} bytes; ask for fewer items or narrower fields.`));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (aborted) return;
          const responseData = Buffer.concat(chunks).toString("utf8");
          if (response.statusCode === 404 && options?.tolerateNotFound) {
            resolve({});
            return;
          }
          if (response.statusCode && response.statusCode >= 400) {
            reject(new Error(`Composio API ${method} ${url} returned ${response.statusCode}: ${responseData.slice(0, 200)}`));
            return;
          }
          try {
            resolve(JSON.parse(responseData) as Record<string, unknown>);
          } catch {
            reject(new Error(`Composio API returned non-JSON response: ${responseData.slice(0, 200)}`));
          }
        });
        response.on("error", reject);
      });
      request.on("error", reject);
      if (body) request.write(JSON.stringify(body));
      request.end();
    });
  }
}

function normalizeToolSchema(raw: Record<string, unknown>): ComposioToolSchema {
  const params = raw.input_parameters ?? raw.parameters ?? raw.inputSchema ?? {};
  const schema = typeof params === "object" && params !== null ? params as Record<string, unknown> : {};
  const toolkit = (raw.toolkit ?? {}) as Record<string, unknown>;
  return {
    name: String(raw.slug ?? raw.name ?? ""),
    description: String(raw.description ?? "").slice(0, 300),
    toolkitSlug: typeof toolkit.slug === "string" ? toolkit.slug : null,
    parameters: {
      type: "object",
      properties: (schema.properties ?? {}) as Record<string, unknown>,
      required: Array.isArray(schema.required) ? schema.required as string[] : [],
    },
  };
}
