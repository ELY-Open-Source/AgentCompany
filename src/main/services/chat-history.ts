import type { DatabaseSync } from "node:sqlite";
import type { SpaceHistoryPage, ThreadHistory } from "../../shared/chat-domain";
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

type Row = Record<string, unknown>;

/** Which older messages to return: the next page before the cursor, or every message from a loaded one up to the cursor. */
export type HistoryScope = { limit: number } | { fromMessageId: string };

/** A conversation's messages before a loaded one (or its newest when none is loaded), in time then insertion order, with what they carry. */
export function spaceHistory(db: DatabaseSync, orgId: string, spaceId: string, beforeMessageId: string | null, scope: HistoryScope): SpaceHistoryPage {
  if (!db.prepare("select id from chat_spaces where id = ? and org_id = ?").get(spaceId, orgId)) throw new Error("Chat space was not found.");
  const position = (messageId: string, what: string) => {
    const row = db.prepare("select created_at, rowid from chat_messages where id = ? and space_id = ? and org_id = ?")
      .get(messageId, spaceId, orgId) as { created_at: string; rowid: number } | undefined;
    if (!row) throw new Error(`The ${what} is not in this conversation.`);
    return [row.created_at, row.rowid] as const;
  };
  const conditions = ["space_id = ?"];
  const params: Array<string | number> = [spaceId];
  if (beforeMessageId !== null) {
    conditions.push("(created_at, rowid) < (?, ?)");
    params.push(...position(beforeMessageId, "earliest loaded message"));
  }
  if ("fromMessageId" in scope) {
    conditions.push("(created_at, rowid) >= (?, ?)");
    params.push(...position(scope.fromMessageId, "oldest loaded message"));
  }
  const limit = "limit" in scope ? scope.limit : -1;
  const rows = db.prepare(`select *, rowid as seq from chat_messages where ${conditions.join(" and ")} order by created_at desc, rowid desc limit ?`)
    .all(...params, limit === -1 ? -1 : limit + 1) as Row[];
  const page = (limit === -1 ? rows : rows.slice(0, limit)).reverse();
  const oldest = page[0];
  const hasMore = limit !== -1 ? rows.length > limit : oldest !== undefined && db.prepare(`
    select 1 from chat_messages where space_id = ? and (created_at, rowid) < (?, ?) limit 1
  `).get(spaceId, oldest.created_at as string, oldest.seq as number) !== undefined;
  const ids = JSON.stringify(page.map((row) => row.id));
  const carried = <T>(sql: string) => (db.prepare(sql).all(ids) as Row[]).map((row) => camel(row) as T);
  return {
    messages: page.map(({ seq: _seq, ...row }) => camel(row) as unknown as SpaceHistoryPage["messages"][number]),
    attachments: carried("select * from chat_attachments where message_id in (select value from json_each(?)) order by message_id"),
    mentions: carried("select * from chat_mentions where message_id in (select value from json_each(?)) order by message_id, offset_start"),
    slashInvocations: carried("select * from chat_slash_invocations where message_id in (select value from json_each(?)) order by message_id"),
    threads: carried("select * from chat_threads where id in (select thread_id from chat_messages where id in (select value from json_each(?)))"),
    hasMore,
  };
}
