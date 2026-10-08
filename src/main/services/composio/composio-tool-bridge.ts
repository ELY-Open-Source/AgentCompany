import type { DatabaseSync } from "node:sqlite";
import type { ToolDefinition, ToolCall } from "../provider-tool-turn";
import { ComposioClient, type ComposioToolSchema } from "./composio-client";
import type { IntegrationKeyStore } from "../integration-key-store";
import { ConnectorGrantsService } from "./connector-grants";
import { currentRunId } from "../run-control";

const COMPOSIO_TOOL_PREFIX = "composio_";
export const FIND_ACTIONS_TOOL = "composio_find_actions";
export const RUN_ACTION_TOOL = "composio_run_action";
const CATALOG_TTL_MS = 5 * 60 * 1000;
const MATCHES_SHOWN = 10;

/** Every action of the granted toolkits, by key and toolkit set, refreshed after the TTL. */
const catalogCache = new Map<string, { actions: ComposioToolSchema[]; fetchedAt: number }>();

export function isComposioTool(toolName: string): boolean {
  return toolName.startsWith(COMPOSIO_TOOL_PREFIX);
}

/** An agent's connector tools: search every action of its granted toolkits, then run one; hundreds of actions would not fit as tools. */
export function loadComposioTools(db: DatabaseSync, keys: IntegrationKeyStore, orgId: string, agentId: string): ToolDefinition[] {
  const toolkits = new ConnectorGrantsService(db).toolkitsForAgent(orgId, agentId);
  if (toolkits.length === 0) return [];
  if (!keys.read("composio")) {
    throw new Error(`Agent ${agentId} holds connector grants (${toolkits.join(", ")}) but no Composio API key is saved in Settings > Integrations.`);
  }
  return [
    {
      name: FIND_ACTIONS_TOOL,
      description: `Search every action of your connected services (${toolkits.join(", ")}). Returns the best matches with the exact input each takes; then call ${RUN_ACTION_TOOL}.`,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "What you want to do, in a few words, e.g. \"create pull request\"." },
          toolkit: { type: "string", enum: toolkits, description: "Search one service only." },
        },
        required: ["query"],
      },
    },
    {
      name: RUN_ACTION_TOOL,
      description: `Run one action found with ${FIND_ACTIONS_TOOL}.`,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { type: "string", description: "The action's name exactly as found, e.g. GITHUB_CREATE_A_PULL_REQUEST." },
          arguments: { type: "object", description: "The action's input, following the schema the search returned." },
        },
        required: ["action", "arguments"],
      },
    },
  ];
}

export async function executeComposioTool(
  db: DatabaseSync,
  keys: IntegrationKeyStore,
  orgId: string,
  agentId: string,
  call: ToolCall,
): Promise<string> {
  const apiKey = keys.read("composio");
  if (!apiKey) return "ERROR: No Composio API key is saved. Ask the board to add one in Settings > Integrations.";
  const toolkits = new ConnectorGrantsService(db).toolkitsForAgent(orgId, agentId);
  if (toolkits.length === 0) return "ERROR: You hold no connector grants. Ask the CEO to grant you one (grant_connector).";
  try {
    if (call.name === FIND_ACTIONS_TOOL) return await findActions(db, apiKey, toolkits, call.arguments);
    if (call.name === RUN_ACTION_TOOL) return await runAction(db, apiKey, orgId, agentId, toolkits, call.arguments);
    return `ERROR: ${call.name} is not a connector tool; use ${FIND_ACTIONS_TOOL} and ${RUN_ACTION_TOOL}.`;
  } catch (error) {
    return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function findActions(db: DatabaseSync, apiKey: string, toolkits: string[], args: Record<string, unknown>): Promise<string> {
  const query = typeof args.query === "string" ? args.query.trim().toLowerCase() : "";
  if (!query) return "ERROR: query is required: say in a few words what you want to do.";
  const toolkit = typeof args.toolkit === "string" ? args.toolkit.toLowerCase() : null;
  if (toolkit && !toolkits.includes(toolkit)) return `ERROR: You hold no grant for "${toolkit}". Your services: ${toolkits.join(", ")}.`;
  const actions = (await actionCatalog(db, apiKey, toolkits)).filter((action) => !toolkit || action.toolkitSlug?.toLowerCase() === toolkit);
  const words = query.split(/[^a-z0-9]+/).filter(Boolean);
  const scored = actions
    .map((action) => {
      const text = `${action.name} ${action.description}`.toLowerCase();
      return { action, score: words.filter((word) => text.includes(word)).length };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.action.name.length - b.action.name.length)
    .slice(0, MATCHES_SHOWN);
  if (scored.length === 0) return `No action of ${toolkit ?? toolkits.join(", ")} matches "${query}" among ${actions.length}. Try other words.`;
  return JSON.stringify({
    matches: scored.map(({ action }) => ({ action: action.name, toolkit: action.toolkitSlug, description: action.description, input: action.parameters })),
    searched: actions.length,
  });
}

async function runAction(db: DatabaseSync, apiKey: string, orgId: string, agentId: string, toolkits: string[], args: Record<string, unknown>): Promise<string> {
  const name = typeof args.action === "string" ? args.action.trim().toUpperCase() : "";
  if (!name) return `ERROR: action is required; find one with ${FIND_ACTIONS_TOOL}.`;
  const action = (await actionCatalog(db, apiKey, toolkits)).find((candidate) => candidate.name.toUpperCase() === name);
  if (!action?.toolkitSlug) return `ERROR: ${name} is not an action of your connected services (${toolkits.join(", ")}); find one with ${FIND_ACTIONS_TOOL}.`;
  const toolkit = action.toolkitSlug.toLowerCase();
  // Grants are read again after the catalog load: one revoked meanwhile must stop the action.
  if (!new ConnectorGrantsService(db).toolkitsForAgent(orgId, agentId).includes(toolkit)) {
    return `ERROR: You have no grant for the "${toolkit}" connector. Ask the CEO to grant it to you (grant_connector).`;
  }
  const account = db.prepare(
    "select id from connector_accounts where org_id = ? and toolkit_slug = ? and status = 'ACTIVE'",
  ).get(orgId, toolkit) as { id: string } | undefined;
  if (!account) return `ERROR: The "${toolkit}" connector is no longer connected. Ask the board to reconnect it on the Connectors page.`;
  const input = typeof args.arguments === "object" && args.arguments !== null && !Array.isArray(args.arguments) ? args.arguments as Record<string, unknown> : null;
  if (!input) return "ERROR: arguments must be an object matching the action's input.";
  const result = await new ComposioClient(apiKey).executeTool({ toolName: action.name, arguments: input, userId: getComposioUserId(db, orgId), connectedAccountId: account.id });
  if (!result.successful) {
    console.warn(`[connectors] ${action.name} failed: ${result.error.replace(/\s+/g, " ")}`);
    return `ERROR: ${action.name} failed: ${result.error}`;
  }
  return JSON.stringify(result.data);
}

/** The full action list of the granted toolkits, every page of it; a failed listing reaches the agent and is named on the run. */
async function actionCatalog(db: DatabaseSync, apiKey: string, toolkits: string[]): Promise<ComposioToolSchema[]> {
  const cacheKey = `${apiKey}:${[...toolkits].sort().join(",")}`;
  const cached = catalogCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CATALOG_TTL_MS) return cached.actions;
  try {
    const actions = await new ComposioClient(apiKey).getTools(toolkits);
    catalogCache.set(cacheKey, { actions, fetchedAt: Date.now() });
    return actions;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    noteMissingCapability(db, `The actions of ${toolkits.join(", ")} could not be listed: ${reason}`);
    throw error;
  }
}

/** Names a capability the current run went without, once, on the run the user looks at; also logged. */
function noteMissingCapability(db: DatabaseSync, text: string): void {
  // One line per gap: error bodies (JSON, HTML) arrive with their own line breaks.
  const warning = text.replace(/\s+/g, " ").trim();
  console.warn(`[connectors] ${warning}`);
  const runId = currentRunId();
  if (!runId) return;
  const row = db.prepare("select capability_warnings from task_runs where id = ?").get(runId) as { capability_warnings: string | null } | undefined;
  const lines = row?.capability_warnings ? row.capability_warnings.split("\n") : [];
  if (lines.includes(warning)) return;
  db.prepare("update task_runs set capability_warnings = ? where id = ?").run([...lines, warning].join("\n"), runId);
}

export function getComposioUserId(db: DatabaseSync, orgId: string): string {
  const row = db.prepare(
    "select value from composio_settings where org_id = ? and key = 'entity_id' limit 1",
  ).get(orgId) as { value: string } | undefined;
  return row?.value ?? orgId;
}
