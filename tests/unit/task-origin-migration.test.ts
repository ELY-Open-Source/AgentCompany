import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { taskOriginSchema } from "../../src/main/database/migrations/055-task-origin";

describe("task origin migration", () => {
  test("adds the column and backfills historical wake vehicles from their runs", () => {
    const db = new DatabaseSync(join(tmpdir(), `agentcompany-origin-migration-${randomUUID()}.db`));
    db.exec(`
      create table schema_migrations(version integer primary key, name text not null, applied_at text not null);
      create table tasks(id text primary key, status text not null, updated_at text not null);
      create table task_runs(id text primary key, task_id text not null, trigger text not null, state text not null);
      insert into schema_migrations(version, name, applied_at) values (54, 'close_stale_wake_tasks', datetime('now'));
      insert into tasks(id, status, updated_at) values ('tsk_wake', 'done', datetime('now'));
      insert into tasks(id, status, updated_at) values ('tsk_real', 'done', datetime('now'));
      insert into task_runs(id, task_id, trigger, state) values ('run_1', 'tsk_wake', 'chat_mention', 'completed');
      insert into task_runs(id, task_id, trigger, state) values ('run_2', 'tsk_real', 'heartbeat', 'completed');
    `);

    db.exec(taskOriginSchema);

    const origins = Object.fromEntries(
      (db.prepare("select id, origin from tasks").all() as Array<{ id: string; origin: string | null }>).map((row) => [row.id, row.origin]),
    );
    expect(origins).toEqual({ tsk_wake: "chat_wake", tsk_real: null });
    expect(db.prepare("select version from schema_migrations order by version desc limit 1").get()).toEqual({ version: 55 });
  });
});
