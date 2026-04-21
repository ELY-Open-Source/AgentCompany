/**
 * `file_approval` internal tool (C4 part 2/5).
 *
 * Collapses the `bash + node -e + fetch POST /api/companies/:id/approvals`
 * chain into a single tool-call the CEO (or any agent with request
 * authority) can invoke directly. The handler in main reuses the same
 * `db.approvalsMod.requestApproval` primitive and auto-approval policy
 * the HTTP route uses, so both paths produce identical rows and the
 * `approve_ceo_strategy` ordering gate fires identically.
 *
 * Like `hire_agent`, the worker-side `execute` is a thin RPC proxy.
 * Validation failures come back as classified errors from main; pi's
 * tool-error convention surfaces them to the model on the next turn.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "@mariozechner/pi-ai";
import type { WorkerRpcClient } from "../../entry/rpc";
import type {
  InvokeInternalToolRpcPayload,
  InvokeInternalToolRpcResult,
} from "./internal-tool-rpc";

export const FILE_APPROVAL_TOOL_NAME = "file_approval";

/**
 * TypeBox schema for `file_approval` arguments.
 *
 * Kept intentionally narrow (type + summaries + optional payload JSON)
 * so the model sees the shape of an approval as a primitive concept
 * rather than an HTTP body to marshal. `type` is an enum drawn directly
 * from `shared/contracts/schemas-approvals.ts :: approvalInputSchema`;
 * the handler re-validates with zod so adding a new approval type over
 * there does not silently un-gate here.
 */
export const fileApprovalSchema = Type.Object({
  type: Type.Union(
    [
      Type.Literal("hire_agent"),
      Type.Literal("approve_ceo_strategy"),
      Type.Literal("dangerous_command"),
      Type.Literal("secret_access"),
      Type.Literal("budget_request"),
      Type.Literal("promotion"),
      Type.Literal("termination"),
      Type.Literal("vendor_approval"),
      Type.Literal("document_review"),
      Type.Literal("production_deploy"),
      Type.Literal("incident_escalation"),
      Type.Literal("social_post"),
      Type.Literal("deliverable_review"),
      Type.Literal("budget_override"),
      Type.Literal("plan_review"),
      Type.Literal("scope_review"),
      Type.Literal("draft_review"),
      Type.Literal("strategy_review"),
      Type.Literal("exception_review"),
    ],
    {
      description:
        "Approval type. Use 'approve_ceo_strategy' after filing the initial hire_agent approvals to lock in the org shape.",
    },
  ),
  payloadSummary: Type.String({
    description:
      "One-line human-readable summary of what is being approved (≤280 chars).",
    minLength: 2,
    maxLength: 280,
  }),
  impactSummary: Type.String({
    description:
      "Why this approval matters / business rationale (≤400 chars).",
    minLength: 2,
    maxLength: 400,
  }),
  payloadJson: Type.Optional(
    Type.String({
      description:
        "Optional JSON string carrying type-specific structured payload (hire proposal, social draft, etc.). Must be valid JSON if provided. For attaching existing documents or work products, use documentIds / workProductIds — the board UI renders those directly on the first screen.",
    }),
  ),
  documentIds: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "UUIDs of existing company documents to attach to this approval. The board inspector surfaces each attachment on the first screen of the approval modal. Prefer this over jamming {documentIds:[...]} into payloadJson.",
    }),
  ),
  workProductIds: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "UUIDs of existing work products (files on disk, external URLs) to attach to this approval. The board inspector renders each row as a clickable link that opens in the operator's default application.",
    }),
  ),
  relatedTaskId: Type.Optional(
    Type.String({
      description: "UUID of the task this approval pertains to, if any.",
    }),
  ),
  relatedAgentId: Type.Optional(
    Type.String({
      description: "UUID of the agent this approval pertains to, if any.",
    }),
  ),
});

export type FileApprovalToolInput = Static<typeof fileApprovalSchema>;

/**
 * Construct the worker-side `file_approval` tool.
 *
 * Routes every call through the internal-tool RPC method so main owns
 * the approval creation + auto-approval policy.
 */
export function createFileApprovalTool(rpc: WorkerRpcClient, runId: string): AgentTool<typeof fileApprovalSchema> {
  return {
    name: FILE_APPROVAL_TOOL_NAME,
    label: "file approval",
    description:
      "File an approval request with the company board. Use for 'approve_ceo_strategy' after filing initial hires, or for any other decision that requires board sign-off. When the approval references existing documents or work products (e.g. deliverable_review, document_review), pass their UUIDs via documentIds / workProductIds so the board inspector can render them as clickable attachments on the first screen — do not bury IDs inside payloadJson. The request is auto-approved when the company is in hands-off mode; otherwise it waits for the human operator.",
    parameters: fileApprovalSchema,
    async execute(toolCallId, params, _signal?, _onUpdate?) {
      const payload: InvokeInternalToolRpcPayload = {
        toolName: FILE_APPROVAL_TOOL_NAME,
        toolCallId,
        args: params,
      };
      const response = await rpc.invoke(runId, "invokeInternalTool", payload);
      if (!response.ok) {
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
