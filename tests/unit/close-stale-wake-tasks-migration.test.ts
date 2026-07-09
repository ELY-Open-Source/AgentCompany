import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { closeStaleWakeTasksSchema } from "../../src/main/database/migrations/054-close-stale-wake-tasks";

function createDatabase(): DatabaseSync {
  const db = new DatabaseSync(join(tmpdir(), `agentcompany-wake-migration-${randomUUID()}.db`));
  db.exec(`
    create table schema_migrations(version integer primary key, name text not null, applied_at text not null);
    create table tasks(id text primary key, status text not null, updated_at text not null);
    create table task_runs(id text primary key, task_id text not null, trigger text not null, state text not null);
    insert into schema_migrations(version, name, applied_at) values (53, 'autonomous_pause', datetime('now'));
  `);
  return db;
}

function seedTask(db: DatabaseSync, taskId: string, status: string, runs: Array<{ trigger: string; state: string }>): void {
  db.prepare("insert into tasks(id, status, updated_at) values (?, ?, datetime('now'))").run(taskId, status);
  for (const run of runs) {
    db.prepare("insert into task_runs(id, task_id, trigger, state) values (?, ?, ?, ?)")
      .run(`run_${randomUUID()}`, taskId, run.trigger, run.state);
  }
}

describe("close stale wake tasks migration", () => {
  test("closes spent chat-wake tasks and leaves everything else alone", () => {
    const db = createDatabase();
    // Zombie: reply went out but the task was never closed.
    seedTask(db, "tsk_replied", "backlog", [{ trigger: "chat_mention", state: "completed" }]);
    // Zombie: every attempt failed on the provider limit; the conversation has moved on.
    seedTask(db, "tsk_starved", "backlog", [
      { trigger: "chat_mention", state: "failed" },
      { trigger: "heartbeat", state: "failed" },
      { trigger: "heartbeat", state: "failed" },
    ]);
    // In-flight wake: its queued run must keep working.
    seedTask(db, "tsk_pending", "backlog", [{ trigger: "chat_mention", state: "queued" }]);
    // Real work is not a wake vehicle and is never touched.
    seedTask(db, "tsk_real", "backlog", [{ trigger: "heartbeat", state: "completed" }]);

    db.exec(closeStaleWakeTasksSchema);

    const statuses = Object.fromEntries(
      (db.prepare("select id, status from tasks").all() as Array<{ id: string; status: string }>).map((row) => [row.id, row.status]),
    );
    expect(statuses).toEqual({
      tsk_replied: "done",
      tsk_starved: "done",
      tsk_pending: "backlog",
      tsk_real: "backlog",
    });
    expect(db.prepare("select version from schema_migrations order by version desc limit 1").get()).toEqual({ version: 54 });
  });
});
