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

/**
 * pi `beforeToolCall` / `afterToolCall` bridge.
 *
 * **Execution-mode contract.** Both AI CEO and AI Co-Founder modes run the
 * pi Agent fully autonomously — the framework layer never gates a tool
 * call with a synchronous human-approval promise. Under AI Co-Founder, the
 * model itself is instructed (via the system prompt + a dedicated
 * `request_approval` tool) to pause when it judges human review necessary.
 * Blocking every `bash` / `edit` / `write` at the Electron layer would
 * defeat the pi-mono runtime and starve the agent of progress.
 *
 * `before` therefore always approves. `after` is a no-op audit point; the
 * agent-event stream persists the real tool record via SqliteSessionStore.
 * `cancelAll` remains for shutdown symmetry but has no queued callers.
 */
export class HumanApprovalHook {
  constructor(private readonly _deps: HumanApprovalHookDeps) {
    void this._deps;
  }

  async before(_runId: string, _payload: BeforeRequestPayload): Promise<{ block?: boolean; reason?: string }> {
    return {};
  }

  async after(_runId: string, _payload: AfterRequestPayload): Promise<void> {
    /* no-op */
  }

  /**
   * Retained so `RuntimeBridge.release()` can call it during app shutdown
   * without knowing whether any approvals were actually queued. The
   * autonomous hook never queues anything, so this is always a no-op.
   */
  cancelAll(_reason: string): void {
    /* no-op */
  }
}
