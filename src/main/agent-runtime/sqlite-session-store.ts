import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AppDatabase } from "@main/database";
import { compactMessagesIfNeeded } from "./context-compactor";
import {
  decodeAgentMessageFromSessionEntry,
  encodeAgentMessageForSession,
  getAgentMessageRole,
  validateNewAgentMessageForSession,
} from "./agent-message-schema";

/**
 * SQLite-backed pi `AgentMessage[]` store.
 *
 * One store instance per task_session. `appendMessage` runs exactly
 * once per pi `message_end` event; `loadMessages` reads the live
 * transcript back at `prepareRun`. When the persisted transcript
 * crosses the compaction threshold, `loadMessages` writes a durable
 * summary row and supersedes the older rows inside one DB transaction,
 * leaving the recent tail as the active transcript.
 */
export class SqliteSessionStore {
  constructor(
    private readonly db: AppDatabase,
    public readonly taskSessionId: string,
  ) {}

  loadMessages(): AgentMessage[] {
    const rows = this.db.projection.sessionEntries.listActive(this.taskSessionId);
    const messages: AgentMessage[] = [];
    for (const row of rows) {
      if (row.kind === "message") {
        messages.push(decodeAgentMessageFromSessionEntry(row));
      }
    }
    const outcome = compactMessagesIfNeeded(messages);
    if (!outcome.changed || !outcome.messages || !outcome.telemetry) {
      return messages;
    }
    const summary = outcome.messages[0];
    if (!summary) {
      return messages;
    }
    const olderRows = rows.slice(0, outcome.telemetry.compactedOlderMessageCount);
    this.db.projection.sessionEntries.compactWithSummary({
      taskSessionId: this.taskSessionId,
      supersedeEntryIds: olderRows.map((row) => row.id),
      summaryRole: getAgentMessageRole(summary),
      summaryPayloadJson: encodeAgentMessageForSession(summary),
    });
    return outcome.messages;
  }

  appendMessage(message: AgentMessage): void {
    const normalized = validateNewAgentMessageForSession(message);
    this.db.projection.sessionEntries.append({
      taskSessionId: this.taskSessionId,
      kind: "message",
      role: getAgentMessageRole(normalized),
      payloadJson: encodeAgentMessageForSession(normalized),
    });
  }
}
