import { net } from "electron";

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

export interface ComposioToolkitSummary {
  slug: string;
  name: string;
  description: string;
  logo: string | null;
  categories: string[];
  authSchemes: string[];
  noAuth: boolean;
  toolsCount: number;
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

export class ComposioClient {
  constructor(private readonly apiKey: string) {}

  /** The toolkit catalog, most popular first. */
  async listToolkits(limit: number): Promise<ComposioToolkitSummary[]> {
    const toolkits: ComposioToolkitSummary[] = [];
    let cursor: string | null = null;
    while (toolkits.length < limit) {
      const params = new URLSearchParams({ limit: String(Math.min(100, limit - toolkits.length)) });
      if (cursor) params.set("cursor", cursor);
      const response = await this.request("GET", `${BASE_URL}/toolkits?${params.toString()}`);
      const items = Array.isArray(response.items) ? response.items as Array<Record<string, unknown>> : [];
      for (const item of items) {
        const meta = (item.meta ?? {}) as Record<string, unknown>;
        toolkits.push({
          slug: String(item.slug ?? ""),
          name: String(item.name ?? ""),
          description: String(meta.description ?? "").slice(0, 200),
          logo: typeof meta.logo === "string" ? meta.logo : null,
          categories: Array.isArray(meta.categories)
            ? (meta.categories as Array<Record<string, unknown>>).map((c) => String(c.name ?? c.id ?? "")).filter(Boolean)
            : [],
          authSchemes: Array.isArray(item.auth_schemes) ? (item.auth_schemes as unknown[]).map(String) : [],
          noAuth: item.no_auth === true,
          toolsCount: Number(meta.tools_count ?? 0),
        });
      }
      cursor = typeof response.next_cursor === "string" && response.next_cursor ? response.next_cursor : null;
      if (!cursor || items.length === 0) break;
    }
    return toolkits;
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

  /** Creates a Composio-managed auth config for a toolkit. */
  async createAuthConfig(toolkitSlug: string): Promise<string> {
    const response = await this.request("POST", `${BASE_URL}/auth_configs`, {
      toolkit: { slug: toolkitSlug },
    });
    const authConfig = (response.auth_config ?? {}) as Record<string, unknown>;
    const id = String(authConfig.id ?? "");
    if (!id) throw new Error("Composio auth config creation returned no id.");
    return id;
  }

  /** Starts a connection for a user; the redirect URL completes it in the browser. */
  async createConnectedAccount(input: { authConfigId: string; userId: string }): Promise<{
    id: string;
    status: string;
    redirectUrl: string | null;
  }> {
    const response = await this.request("POST", `${BASE_URL}/connected_accounts`, {
      auth_config: { id: input.authConfigId },
      connection: { user_id: input.userId },
    });
    return {
      id: String(response.id ?? ""),
      status: String(response.status ?? ""),
      redirectUrl: typeof response.redirect_url === "string" ? response.redirect_url : null,
    };
  }

  async listConnectedAccounts(userId: string): Promise<ComposioConnectedAccount[]> {
    const params = new URLSearchParams({ user_ids: userId, limit: "50" });
    const response = await this.request("GET", `${BASE_URL}/connected_accounts?${params.toString()}`);
    if (!Array.isArray(response.items)) return [];
    return (response.items as Array<Record<string, unknown>>).map((item) => {
      const toolkit = (item.toolkit ?? {}) as Record<string, unknown>;
      const authConfig = (item.auth_config ?? {}) as Record<string, unknown>;
      return {
        id: String(item.id ?? ""),
        toolkitSlug: String(toolkit.slug ?? "").toLowerCase(),
        status: String(item.status ?? ""),
        authConfigId: String(authConfig.id ?? ""),
        createdAt: String(item.created_at ?? ""),
      };
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

  private async request(method: string, url: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const request = net.request({ method, url });
      request.setHeader("x-api-key", this.apiKey);
      request.setHeader("Accept", "application/json");
      if (body) request.setHeader("Content-Type", "application/json");

      let responseData = "";
      request.on("response", (response) => {
        response.on("data", (chunk) => { responseData += chunk.toString(); });
        response.on("end", () => {
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
