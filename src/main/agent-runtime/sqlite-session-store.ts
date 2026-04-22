import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AppDatabase } from "@main/database";

/**
 * SQLite-backed pi `AgentMessage[]` store.
 *
 * One store instance per task_session. `appendMessage` runs exactly
 * once per pi `message_end` event; `loadMessages` reads the live
 * transcript back at `prepareRun`. Compaction happens at LLM-call
 * time via pi's `transformContext` hook and does not rewrite the
 * persisted transcript — the session shadow is the durable truth,
 * the compacted payload is a per-call view.
 */
export class SqliteSessionStore {
  constructor(
    private readonly db: AppDatabase,
    public readonly taskSessionId: string,
  ) {}

  loadMessages(): AgentMessage[] {
    const rows = this.db.projection.sessionEntries.listActive(this.taskSessionId);
    const result: AgentMessage[] = [];
    for (const row of rows) {
      if (row.kind === "message") {
        result.push(JSON.parse(row.payloadJson) as AgentMessage);
      }
    }
    return result;
  }

  appendMessage(message: AgentMessage): void {
    this.db.projection.sessionEntries.append({
      taskSessionId: this.taskSessionId,
      kind: "message",
      role: (message as { role?: string }).role ?? null,
      payloadJson: JSON.stringify(message),
    });
  }
}
