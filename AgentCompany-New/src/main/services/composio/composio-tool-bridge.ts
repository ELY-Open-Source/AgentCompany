import type { DatabaseSync } from "node:sqlite";
import type { ToolDefinition, ToolCall } from "../provider-tool-turn";
import { ComposioClient, type ComposioToolSchema } from "./composio-client";

const COMPOSIO_TOOL_PREFIX = "composio_";

export function isComposioTool(toolName: string): boolean {
  return toolName.startsWith(COMPOSIO_TOOL_PREFIX);
}

export function composioToolName(composioName: string): string {
  return `${COMPOSIO_TOOL_PREFIX}${composioName.toLowerCase()}`;
}

function originalToolName(prefixedName: string): string {
  return prefixedName.slice(COMPOSIO_TOOL_PREFIX.length).toUpperCase();
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

export async function loadComposioTools(db: DatabaseSync, orgId: string): Promise<ToolDefinition[]> {
  const apiKey = getComposioApiKey(db, orgId);
  if (!apiKey) return [];
  const toolkits = getEnabledToolkits(db, orgId);
  if (toolkits.length === 0) return [];
  const client = new ComposioClient(apiKey);
  const schemas = await client.getTools(toolkits);
  return schemas.map(composioSchemaToToolDefinition);
}

export async function executeComposioTool(
  db: DatabaseSync,
  orgId: string,
  call: ToolCall,
): Promise<string> {
  const apiKey = getComposioApiKey(db, orgId);
  if (!apiKey) return "ERROR: Composio API key is not configured.";
  const toolName = originalToolName(call.name);
  const entityId = getComposioEntityId(db, orgId);
  const client = new ComposioClient(apiKey);
  const result = await client.executeTool({
    toolName,
    arguments: call.arguments,
    entityId,
  });
  if (result.error) return `ERROR: ${result.error}`;
  return JSON.stringify(result.data);
}

function getComposioApiKey(db: DatabaseSync, orgId: string): string | null {
  const row = db.prepare(
    "select value from composio_settings where org_id = ? and key = 'api_key' limit 1",
  ).get(orgId) as { value: string } | undefined;
  return row?.value ?? null;
}

function getComposioEntityId(db: DatabaseSync, orgId: string): string {
  const row = db.prepare(
    "select value from composio_settings where org_id = ? and key = 'entity_id' limit 1",
  ).get(orgId) as { value: string } | undefined;
  return row?.value ?? orgId;
}

function getEnabledToolkits(db: DatabaseSync, orgId: string): string[] {
  const row = db.prepare(
    "select value from composio_settings where org_id = ? and key = 'toolkits' limit 1",
  ).get(orgId) as { value: string } | undefined;
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
