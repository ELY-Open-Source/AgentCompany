import type { AppDatabase } from "@main/database";
import type { DesktopEvent } from "@shared/types";

interface BeforeToolCallPayload {
  agentId: string;
  companyId: string;
  taskId: string | null;
  toolCallId: string;
  toolName: string;
  args: unknown;
}

interface PendingApproval {
  resolve: (verdict: { block?: boolean; reason?: string }) => void;
}

export interface HumanApprovalHookDeps {
  db: AppDatabase;
  emitEvent: (event: DesktopEvent) => void;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

/**
 * Tools whose side-effects are read-only (safe to auto-approve in Co-Founder
 * mode). Anything outside this set waits for a human decision.
 *
 * This is intentionally conservative: `bash` is gated even for obviously
 * safe commands like `ls`, because parsing shell syntax for safety is its
 * own class of bug. If users want per-command auto-approval they can
 * approve once and the run proceeds; the alternative is a false sense of
 * security.
 */
const AUTO_APPROVED_TOOLS = new Set<string>([
  "read",
  "ls",
  "glob",
  "grep",
  "find",
  "tree",
]);

function summarizeArgs(args: unknown, maxLen = 240): string {
  if (args === undefined || args === null) return "";
  try {
    const json = typeof args === "string" ? args : JSON.stringify(args);
    return json.length <= maxLen ? json : `${json.slice(0, maxLen - 1)}…`;
  } catch {
    return "<unserialisable>";
  }
}

/**
 * Gates pi `beforeToolCall` invocations against the Human-in-the-Loop
 * approval system used by AI Co-Founder mode.
 *
 * Contract:
 * - Tools in AUTO_APPROVED_TOOLS resolve synchronously with `{}` (no-op).
 * - Everything else creates a `dangerous_command` approval row, emits an
 *   `approval-updated` event so the renderer can surface it, and blocks
 *   the worker RPC until the human resolves the approval.
 * - Resolutions flow in via `resolveApproval` from the approval-resolution
 *   pipeline in `wire-api-server.ts` (shared with automation + thread).
 * - On shutdown, `cancelAll` releases every pending wait with a block
 *   verdict so the worker can exit cleanly.
 *
 * In AI CEO mode the worker never attaches `beforeToolCall` to the pi
 * Agent, so this class is instantiated but sees zero traffic.
 */
export class HumanApprovalHook {
  private readonly pendingByApproval = new Map<string, PendingApproval>();

  constructor(private readonly deps: HumanApprovalHookDeps) {}

  async before(
    runId: string,
    payload: BeforeToolCallPayload,
  ): Promise<{ block?: boolean; reason?: string }> {
    if (AUTO_APPROVED_TOOLS.has(payload.toolName)) return {};

    const summary = `${payload.toolName}: ${summarizeArgs(payload.args, 160)}`;
    const approvalId = this.deps.db.requestApproval({
      companyId: payload.companyId,
      relatedTaskId: payload.taskId ?? null,
      requestedByAgentId: payload.agentId,
      type: "dangerous_command",
      payloadSummary: summary,
      impactSummary: "Agent requested a gated tool call; Co-Founder mode requires a human decision.",
      payloadJson: JSON.stringify({
        runId,
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        args: payload.args,
      }),
    });

    this.deps.emitEvent({ type: "approval-updated", approvalId, action: "created" });
    this.deps.logger.info(
      `[approval-hook] gated ${payload.toolName} for agent ${payload.agentId} (approval ${approvalId})`,
    );

    return new Promise<{ block?: boolean; reason?: string }>((resolve) => {
      this.pendingByApproval.set(approvalId, { resolve });
    });
  }

  /**
   * Called by the approval-resolution pipeline in `wire-api-server.ts`
   * for every approval decision (automation, UI, HTTP). No-ops when the
   * approvalId is not one we are waiting on.
   */
  resolveApproval(approvalId: string, decision: string): void {
    const pending = this.pendingByApproval.get(approvalId);
    if (!pending) return;
    this.pendingByApproval.delete(approvalId);
    if (decision === "approved") {
      pending.resolve({});
    } else {
      pending.resolve({ block: true, reason: `tool call ${decision} by human reviewer` });
    }
  }

  /**
   * Releases every pending wait with a block verdict. Called on worker
   * shutdown so in-flight RPC promises resolve and the worker can exit.
   */
  cancelAll(reason: string): void {
    for (const [approvalId, pending] of this.pendingByApproval) {
      pending.resolve({ block: true, reason });
      this.pendingByApproval.delete(approvalId);
    }
  }
}
