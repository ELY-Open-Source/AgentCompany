import type { AppDatabase } from "@main/database";
import type { DesktopEvent } from "@shared/types";

interface BeforeRequestPayload {
  agentId: string;
  companyId: string;
  taskId: string | null;
  toolCallId: string;
  toolName: string;
  args: unknown;
}

interface AfterRequestPayload {
  toolCallId: string;
  toolName: string;
  isError: boolean;
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

interface PendingApproval {
  approvalId: string;
  resolve: (verdict: { block?: boolean; reason?: string }) => void;
}

const TOOL_LABEL: Record<string, string> = {
  bash: "shell",
  edit: "edit",
  write: "write",
  read: "read",
  ls: "ls",
  grep: "grep",
  find: "find",
};

function summariseArgs(toolName: string, args: unknown): string {
  if (args === null || typeof args !== "object") return String(args);
  const argsObj = args as Record<string, unknown>;
  switch (toolName) {
    case "bash": {
      const command = typeof argsObj.command === "string" ? argsObj.command : "";
      return command.length > 200 ? `${command.slice(0, 197)}...` : command;
    }
    case "write":
    case "edit":
    case "read": {
      const path = typeof argsObj.path === "string" ? argsObj.path : (typeof argsObj.file_path === "string" ? argsObj.file_path : "");
      return path;
    }
    default:
      try {
        const json = JSON.stringify(args);
        return json.length > 200 ? `${json.slice(0, 197)}...` : json;
      } catch {
        return "<unserialisable args>";
      }
  }
}

/**
 * Human-in-the-loop hook bridging pi `beforeToolCall` to
 * AgentCompany's `ApprovalService` via the existing approvals table.
 */
export class HumanApprovalHook {
  private readonly pending = new Map<string, PendingApproval>();

  constructor(private readonly deps: HumanApprovalHookDeps) {}

  async before(runId: string, payload: BeforeRequestPayload): Promise<{ block?: boolean; reason?: string }> {
    const { db, emitEvent } = this.deps;
    const summary = summariseArgs(payload.toolName, payload.args);
    const label = TOOL_LABEL[payload.toolName] ?? payload.toolName;
    const approvalId = db.requestApproval({
      companyId: payload.companyId,
      relatedTaskId: payload.taskId,
      requestedByAgentId: payload.agentId,
      type: "dangerous_command",
      payloadSummary: `${label}: ${summary}`.slice(0, 280),
      impactSummary: `Agent ${payload.agentId} requested ${label} during run ${runId}.`,
      payloadJson: JSON.stringify({
        runId,
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        args: payload.args,
      }),
    });

    emitEvent({ type: "approval-updated", approvalId, action: "created" });
    emitEvent({ type: "domain-changed" });

    return new Promise<{ block?: boolean; reason?: string }>((resolve) => {
      this.pending.set(approvalId, { approvalId, resolve });
    });
  }

  /**
   * Called by the IPC approval-decided pipeline when a user resolves a
   * pending approval. If we have a pending pi `beforeToolCall` waiting on
   * this approval, resolve it.
   */
  resolveApproval(approvalId: string, decision: "approve" | "reject" | "revision_requested", note: string): boolean {
    const pending = this.pending.get(approvalId);
    if (!pending) return false;
    this.pending.delete(approvalId);
    if (decision === "approve") {
      pending.resolve({});
    } else {
      pending.resolve({ block: true, reason: note || `Tool execution ${decision}.` });
    }
    return true;
  }

  /** Called when a run is cancelled — resolves any pending approvals as blocked. */
  cancelAll(reason: string): void {
    for (const [id, pending] of this.pending) {
      pending.resolve({ block: true, reason });
      this.pending.delete(id);
    }
  }

   
  async after(_runId: string, _payload: AfterRequestPayload): Promise<void> {
    // Audit hook intentionally minimal — actual tool result is captured by
    // the agent-event stream and persisted via SqliteSessionStore.
  }
}
