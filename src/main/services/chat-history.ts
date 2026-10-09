import type { DatabaseSync } from "node:sqlite";
import type { ThreadHistory } from "../../shared/chat-domain";
import { camel } from "./snapshot-service";

/** Every message of one thread with its attachments, mentions and commands, however far back it started. */
export function threadHistory(db: DatabaseSync, orgId: string, threadId: string): ThreadHistory {
  const thread = db.prepare("select id from chat_threads where id = ? and org_id = ?").get(threadId, orgId);
  if (!thread) throw new Error("Chat thread was not found.");
  const rows = <T>(sql: string) => (db.prepare(sql).all(threadId) as Array<Record<string, unknown>>).map((row) => camel(row) as T);
  return {
    messages: rows("select * from chat_messages where thread_id = ? order by created_at, rowid"),
    attachments: rows("select a.* from chat_attachments a join chat_messages m on m.id = a.message_id where m.thread_id = ?"),
    mentions: rows("select x.* from chat_mentions x join chat_messages m on m.id = x.message_id where m.thread_id = ? order by x.offset_start"),
    slashInvocations: rows("select s.* from chat_slash_invocations s join chat_messages m on m.id = s.message_id where m.thread_id = ?"),
  };
}
