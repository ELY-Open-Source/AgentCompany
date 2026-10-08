import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { chatWakeTextPurgeSchema } from "../../src/main/database/migrations/060-chat-wake-text-purge";

describe("chat wake text purge migration", () => {
  test("strips copied message text from chat-wake tasks and leaves real work alone", () => {
    const db = new DatabaseSync(join(tmpdir(), `agentcompany-purge-migration-${randomUUID()}.db`));
    db.exec(`
      create table schema_migrations(version integer primary key, name text not null, applied_at text not null);
      create table tasks(id text primary key, title text not null, description text not null, origin text);
      insert into tasks values ('tsk_slash', 'Chat mention: wire payroll to 99-1234', 'Chat command: /agent @ceo wire payroll to 99-1234', 'chat_wake');
      insert into tasks values ('tsk_mention', 'Reply to Yang', 'Yang messaged you directly:\n"secret plan..."', 'chat_wake');
      insert into tasks values ('tsk_real', 'Chat mention: keep', 'Real description', null);
    `);
    db.exec(chatWakeTextPurgeSchema);
    const rows = Object.fromEntries((db.prepare("select id, title, description from tasks").all() as Array<{ id: string; title: string; description: string }>)
      .map((row) => [row.id, [row.title, row.description]]));
    const generic = "Reply in the source thread with send_message and its thread_id; the full message is in the thread below.";
    expect(rows).toEqual({
      tsk_slash: ["Reply in chat", generic],
      tsk_mention: ["Reply to Yang", generic],
      tsk_real: ["Chat mention: keep", "Real description"],
    });
    expect(db.prepare("select version from schema_migrations").all()).toEqual([{ version: 60 }]);
    db.close();
  });
});
