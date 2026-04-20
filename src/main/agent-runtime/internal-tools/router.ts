/**
 * Dispatch router for main-side internal-tool handlers (C4 part 3/5).
 *
 * The worker RPC method `invokeInternalTool` lands here; this module
 * picks the right handler by `toolName` and delegates. Adding a new
 * internal tool means: (a) new worker-side tool definition under
 * `src/main/worker/runtime/internal-tools/`, (b) new handler under
 * `src/main/agent-runtime/internal-tools/`, (c) one new `case` in the
 * switch below. No third file to update, no registry lookup — the
 * compile-time `never`-exhaustiveness on the default case catches a
 * missing branch at build time.
 *
 * The router never catches: every handler throws a classified
 * `AppError` on failure and the caller (`RuntimeBridge`) translates the
 * throw into the `{ ok: false, error }` RPC envelope. Silent swallow
 * would collapse tool-error plus tool-success onto the same success
 * wire shape, which is the exact failure mode the tool-error
 * convention exists to prevent.
 */

import { HIRE_AGENT_TOOL_NAME } from "@main/worker/runtime/internal-tools/hire-agent-tool";
import { FILE_APPROVAL_TOOL_NAME } from "@main/worker/runtime/internal-tools/file-approval-tool";
import type {
  InvokeInternalToolRpcPayload,
  InvokeInternalToolRpcResult,
} from "@main/worker/runtime/internal-tools/internal-tool-rpc";
import {
  handleHireAgentToolCall,
  type HireAgentHandlerDeps,
} from "./hire-agent-handler";
import {
  handleFileApprovalToolCall,
  type FileApprovalHandlerDeps,
} from "./file-approval-handler";
import { UserInputError } from "@main/errors";

export interface InternalToolRouterDeps {
  hireAgent: HireAgentHandlerDeps;
  fileApproval: FileApprovalHandlerDeps;
}

export interface InternalToolRouterContext {
  companyId: string;
  agentId: string;
}

export function routeInternalToolCall(
  deps: InternalToolRouterDeps,
  ctx: InternalToolRouterContext,
  payload: InvokeInternalToolRpcPayload,
): InvokeInternalToolRpcResult {
  switch (payload.toolName) {
    case HIRE_AGENT_TOOL_NAME:
      return handleHireAgentToolCall(deps.hireAgent, ctx, payload.args);
    case FILE_APPROVAL_TOOL_NAME:
      return handleFileApprovalToolCall(deps.fileApproval, ctx, payload.args);
    default:
      throw new UserInputError({
        code: "internal_tool.unknown",
        message: `Unknown internal tool: ${payload.toolName}`,
        context: { toolName: payload.toolName },
      });
  }
}
