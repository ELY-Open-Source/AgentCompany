import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AppDatabase } from "@main/database";

/**
 * SQLite-backed pi `AgentMessage[]` store.
 *
 * One store instance per task_session. Owners must call `appendMessage`
 * exactly once per pi `message_end` event, and `replaceMessages` after pi
 * `compact` returns a compacted message list.
 */
export class SqliteSessionStore {
  constructor(
    private readonly db: AppDatabase,
    public readonly taskSessionId: string,
  ) {}

  loadMessages(): AgentMessage[] {
    const rows = this.db.sessionEntries.listActive(this.taskSessionId);
    const result: AgentMessage[] = [];
    for (const row of rows) {
      if (row.kind === "message") {
        result.push(JSON.parse(row.payloadJson) as AgentMessage);
      }
    }
    return result;
  }

  appendMessage(message: AgentMessage): void {
    this.db.sessionEntries.append({
      taskSessionId: this.taskSessionId,
      kind: "message",
      role: (message as { role?: string }).role ?? null,
      payloadJson: JSON.stringify(message),
    });
  }

  appendCompaction(summary: string): void {
    this.db.sessionEntries.append({
      taskSessionId: this.taskSessionId,
      kind: "compaction",
      role: null,
      payloadJson: JSON.stringify({ summary }),
    });
  }

  replaceMessages(messages: AgentMessage[], compactionSummary?: string): void {
    const entries: Array<{ kind: "message" | "compaction"; role: string | null; payloadJson: string }> = [];
    if (compactionSummary) {
      entries.push({ kind: "compaction", role: null, payloadJson: JSON.stringify({ summary: compactionSummary }) });
    }
    for (const message of messages) {
      entries.push({
        kind: "message",
        role: (message as { role?: string }).role ?? null,
        payloadJson: JSON.stringify(message),
      });
    }
    this.db.sessionEntries.replace({ taskSessionId: this.taskSessionId, entries });
  }
}
