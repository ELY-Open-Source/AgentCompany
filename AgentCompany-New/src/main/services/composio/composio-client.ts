import { net } from "electron";

const BASE_URL = "https://backend.composio.dev/api/v3";

export interface ComposioToolSchema {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ComposioToolExecutionResult {
  data: Record<string, unknown>;
  error: string | null;
}

export class ComposioClient {
  constructor(private readonly apiKey: string) {}

  async getTools(toolkits: string[]): Promise<ComposioToolSchema[]> {
    const params = new URLSearchParams();
    for (const toolkit of toolkits) params.append("toolkit", toolkit);
    params.set("limit", "50");
    const url = `${BASE_URL}/tools?${params.toString()}`;
    const response = await this.request("GET", url);
    if (!Array.isArray(response.items)) return [];
    return (response.items as Array<Record<string, unknown>>).map(normalizeToolSchema);
  }

  async executeTool(input: {
    toolName: string;
    arguments: Record<string, unknown>;
    entityId: string;
    connectedAccountId?: string;
  }): Promise<ComposioToolExecutionResult> {
    const url = `${BASE_URL}/tools/${encodeURIComponent(input.toolName)}/execute`;
    const body: Record<string, unknown> = {
      entity_id: input.entityId,
      input: input.arguments,
    };
    if (input.connectedAccountId) body.connected_account_id = input.connectedAccountId;
    const response = await this.request("POST", url, body);
    return {
      data: typeof response === "object" && response !== null ? response as Record<string, unknown> : {},
      error: null,
    };
  }

  async getConnectedAccounts(entityId: string): Promise<Array<{ id: string; appName: string; status: string }>> {
    const params = new URLSearchParams({ entity_id: entityId, showActiveOnly: "true" });
    const url = `${BASE_URL}/connectedAccounts?${params.toString()}`;
    const response = await this.request("GET", url);
    if (!Array.isArray(response.items)) return [];
    return (response.items as Array<Record<string, unknown>>).map((item) => ({
      id: String(item.id ?? ""),
      appName: String(item.appName ?? item.app_name ?? ""),
      status: String(item.status ?? ""),
    }));
  }

  async initiateConnection(input: {
    entityId: string;
    appName: string;
    redirectUrl?: string;
  }): Promise<{ redirectUrl: string; connectedAccountId: string }> {
    const url = `${BASE_URL}/connectedAccounts`;
    const body: Record<string, unknown> = {
      entity_id: input.entityId,
      integration_id: input.appName,
    };
    if (input.redirectUrl) body.redirect_url = input.redirectUrl;
    const response = await this.request("POST", url, body);
    return {
      redirectUrl: String(response.redirectUrl ?? response.redirect_url ?? ""),
      connectedAccountId: String(response.connectedAccountId ?? response.id ?? ""),
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
  const params = raw.parameters ?? raw.inputSchema ?? raw.input_schema ?? {};
  const schema = typeof params === "object" && params !== null ? params as Record<string, unknown> : {};
  return {
    name: String(raw.name ?? raw.slug ?? ""),
    description: String(raw.description ?? raw.display_name ?? ""),
    parameters: {
      type: "object",
      properties: (schema.properties ?? {}) as Record<string, unknown>,
      required: Array.isArray(schema.required) ? schema.required as string[] : [],
    },
  };
}
