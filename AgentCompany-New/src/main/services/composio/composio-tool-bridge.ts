import type { DatabaseSync } from "node:sqlite";
import type { ToolDefinition, ToolCall } from "../provider-tool-turn";
import { ComposioClient, type ComposioToolSchema } from "./composio-client";
import { ConnectorGrantsService } from "./connector-grants";

const COMPOSIO_TOOL_PREFIX = "composio_";
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  tools: ToolDefinition[];
  fetchedAt: number;
  toolkitsKey: string;
}

const toolCache = new Map<string, CacheEntry>();
/** tool slug (upper case) → toolkit slug, learned from the tools listing. */
const toolkitByTool = new Map<string, string>();

export function isComposioTool(toolName: string): boolean {
  return toolName.startsWith(COMPOSIO_TOOL_PREFIX);
}

export function composioToolName(composioName: string): string {
  return `${COMPOSIO_TOOL_PREFIX}${composioName.toLowerCase()}`;
}

function originalToolName(prefixedName: string): string {
  return prefixedName.slice(COMPOSIO_TOOL_PREFIX.length).toUpperCase();
}

/** Toolkit a tool belongs to: learned mapping first, slug prefix as contract. */
function toolkitForTool(toolSlug: string): string {
  return toolkitByTool.get(toolSlug) ?? toolSlug.split("_")[0].toLowerCase();
}

export function composioSchemaToToolDefinition(schema: ComposioToolSchema): ToolDefinition {
  return {
    name: composioToolName(schema.name),
    description: schema.description,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: schema.parameters.properties,
      required: schema.parameters.required ?? [],
    },
  };
}

/**
 * The connector tools one agent is allowed to carry into a run: the
 * intersection of the company's active connections and the toolkits the CEO
 * granted this agent.
 */
export async function loadComposioTools(db: DatabaseSync, orgId: string, agentId: string): Promise<ToolDefinition[]> {
  const apiKey = getComposioApiKey(db, orgId);
  if (!apiKey) return [];
  const grants = new ConnectorGrantsService(db);
  const toolkits = grants.toolkitsForAgent(orgId, agentId);
  if (toolkits.length === 0) return [];
  const toolkitsKey = toolkits.join(",");
  const cacheKey = `${orgId}:${toolkitsKey}`;
  const cached = toolCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.tools;
  }
  try {
    const client = new ComposioClient(apiKey);
    const schemas = await client.getTools(toolkits);
    for (const schema of schemas) {
      if (schema.toolkitSlug) toolkitByTool.set(schema.name.toUpperCase(), schema.toolkitSlug.toLowerCase());
    }
    const tools = schemas.map(composioSchemaToToolDefinition);
    toolCache.set(cacheKey, { tools, fetchedAt: Date.now(), toolkitsKey });
    return tools;
  } catch {
    return cached?.tools ?? [];
  }
}

export async function executeComposioTool(
  db: DatabaseSync,
  orgId: string,
  agentId: string,
  call: ToolCall,
): Promise<string> {
  const apiKey = getComposioApiKey(db, orgId);
  if (!apiKey) return "ERROR: Composio API key is not configured for this company.";
  const toolSlug = originalToolName(call.name);
  const toolkit = toolkitForTool(toolSlug);
  const grants = new ConnectorGrantsService(db);
  const allowed = grants.toolkitsForAgent(orgId, agentId);
  if (!allowed.includes(toolkit)) {
    return `ERROR: You have no grant for the "${toolkit}" connector. Ask the CEO to grant it to you (grant_connector).`;
  }
  const account = db.prepare(
    "select id from connector_accounts where org_id = ? and toolkit_slug = ? and status = 'ACTIVE'",
  ).get(orgId, toolkit) as { id: string } | undefined;
  if (!account) {
    return `ERROR: The "${toolkit}" connector is no longer connected. Ask the board to reconnect it on the Connectors page.`;
  }
  const client = new ComposioClient(apiKey);
  try {
    const result = await client.executeTool({
      toolName: toolSlug,
      arguments: call.arguments,
      userId: getComposioUserId(db, orgId),
      connectedAccountId: account.id,
    });
    if (result.error) return `ERROR: ${result.error}`;
    return JSON.stringify(result.data);
  } catch (error) {
    return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function getComposioApiKey(db: DatabaseSync, orgId: string): string | null {
  const row = db.prepare(
    "select value from composio_settings where org_id = ? and key = 'api_key' limit 1",
  ).get(orgId) as { value: string } | undefined;
  return row?.value ?? null;
}

export function getComposioUserId(db: DatabaseSync, orgId: string): string {
  const row = db.prepare(
    "select value from composio_settings where org_id = ? and key = 'entity_id' limit 1",
  ).get(orgId) as { value: string } | undefined;
  return row?.value ?? orgId;
}
