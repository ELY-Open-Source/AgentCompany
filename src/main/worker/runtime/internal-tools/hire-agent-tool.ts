/**
 * `hire_agent` internal tool (C4 part 1/5).
 *
 * Replaces the pre-C4 flow where the CEO had to call the `bash` tool,
 * spawn `node -e`, and POST to `/api/companies/:id/agents` on its own
 * HTTP server. Every layer of that stack was an implementation detail
 * leaking into the LLM prompt — if `bash` or `node` went away, the
 * tool-call would silently fail. The first-class tool collapses the
 * chain to a single pi tool-call whose schema the model can see and
 * whose result comes back on the next turn.
 *
 * The tool is wire-compatible with the HTTP `POST /api/companies/:id/agents`
 * endpoint (same field set, same validation order) so main's handler can
 * reuse the existing `createHireRequest` DB primitive without duplicating
 * the approval + auto-approval plumbing. The HTTP path stays live
 * through the deprecation window documented in C4 part 5/5.
 *
 * Worker side: `execute` is a thin RPC proxy — no schema validation, no
 * fallbacks. An invalid payload (missing field, blank string, duplicate
 * name) surfaces as a `UserInputError` from main, which the RPC envelope
 * converts to `{ ok: false, error }`, which the tool execute wrapper
 * re-throws as an Error. Pi's loop then produces a tool-error result
 * carrying the classified message — exactly what we want the CEO to see
 * on its next turn so it can correct the hire.
 *
 * Main-side handler lives in `hire-agent-handler.ts` and is bound by the
 * internal-tools router registered in `RuntimeBridge`.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "@mariozechner/pi-ai";
import type { WorkerRpcClient } from "../../entry/rpc";
import type {
  InvokeInternalToolRpcPayload,
  InvokeInternalToolRpcResult,
} from "./internal-tool-rpc";

export const HIRE_AGENT_TOOL_NAME = "hire_agent";

/**
 * TypeBox schema for `hire_agent` arguments.
 *
 * Intentionally mirrors `shared/contracts/schemas-agents.ts :: hireRequestSchema`
 * on the main side — the handler re-validates with zod, so the TypeBox
 * schema here is the model-facing advertisement and the zod schema is
 * the boundary. Keeping both narrow (required `name/role/connectorId/model`,
 * optional `department/title/reportsTo`) rejects malformed calls before
 * they hit the DB layer.
 *
 * `department` is a free string here rather than a Union of the canonical
 * set: the schemas-agents file accepts `nullable().optional()` via the
 * shared `DEPARTMENT_IDS` enum, and echoing the enum in TypeBox would
 * force the drift onto two schemas. The main handler validates against
 * `DEPARTMENT_IDS` so an out-of-range value fails closed.
 */
export const hireAgentSchema = Type.Object({
  name: Type.String({
    description:
      "Short display name for the new direct report (e.g. 'Ada Lovelace', 'CTO Claude'). Must be unique within the company and at least 2 characters.",
    minLength: 2,
    maxLength: 80,
  }),
  role: Type.String({
    description:
      "Business role title (e.g. 'Chief Technology Officer', 'Head of Marketing').",
    minLength: 2,
    maxLength: 80,
  }),
  title: Type.Optional(
    Type.String({
      description: "Short title displayed in UI; defaults to empty.",
      maxLength: 80,
    }),
  ),
  department: Type.Optional(
    Type.String({
      description:
        "Department bucket. One of: engineering, product, design, marketing, sales, hr, finance, legal, operations, customer_support, research, executive.",
    }),
  ),
  capabilities: Type.Optional(
    Type.String({
      description:
        "One-paragraph description of what this hire owns. Surfaces in the hire approval and the briefing.",
    }),
  ),
  reportsTo: Type.Optional(
    Type.String({
      description:
        "UUID of the manager this hire should report to. Omit to default to the requesting agent (or the department lead if applicable).",
    }),
  ),
  connectorId: Type.String({
    description:
      "Connector id drawn from the Available Connectors block in the briefing; must be in a ready state.",
  }),
  model: Type.String({
    description:
      "Model id allowed by the connector's enabled-models list (e.g. 'claude-4-7', 'gpt-5').",
  }),
  budgetMonthlyUsd: Type.Optional(
    Type.Number({
      description:
        "Monthly USD spend cap for this hire. Defaults to 150 if omitted.",
      minimum: 0,
    }),
  ),
});

export type HireAgentToolInput = Static<typeof hireAgentSchema>;

/**
 * Construct the worker-side `hire_agent` tool.
 *
 * The returned `AgentTool` routes every call through the internal-tool
 * RPC method so main owns the DB write. No retries, no fallbacks, no
 * argument coercion — the schema is the contract and any deviation
 * surfaces through the pi tool-error convention.
 */
export function createHireAgentTool(rpc: WorkerRpcClient, runId: string): AgentTool<typeof hireAgentSchema> {
  return {
    name: HIRE_AGENT_TOOL_NAME,
    label: "hire agent",
    description:
      "File a hire_agent approval to add one direct report. During CEO Team Building, call this tool 3 to 5 times to populate the initial team. Outside Team Building, use it when the CEO or another manager needs to fill one role. The approval is auto-approved for hands-off companies; otherwise it goes to the board.",
    parameters: hireAgentSchema,
    async execute(toolCallId, params, _signal?, _onUpdate?) {
      const payload: InvokeInternalToolRpcPayload = {
        toolName: HIRE_AGENT_TOOL_NAME,
        toolCallId,
        args: params,
      };
      const response = await rpc.invoke(runId, "invokeInternalTool", payload);
      if (!response.ok) {
        // Propagate classified errors from main. pi wraps the throw into
        // a tool-error result the model sees on the next turn.
        throw new Error(response.error);
      }
      const result = response.result as InvokeInternalToolRpcResult;
      return {
        content: result.content,
        details: result.details,
        isError: result.isError,
      };
    },
  };
}
