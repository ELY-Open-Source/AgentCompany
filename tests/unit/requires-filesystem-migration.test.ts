import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { createMigrationsV52V52 } from "../../src/main/database/migrations/v52-v52";

describe("v52 requires_filesystem migration", () => {
  it("materializes legacy role evidence into the task column", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        create table agents (
          id text primary key,
          role text not null,
          department text
        );
        create table tasks (
          id text primary key,
          status text not null,
          active_run_id text,
          assignee_agent_id text
        );
        insert into agents (id, role, department) values
          ('agent-cto', 'CTO', 'engineering'),
          ('agent-cmo', 'CMO', 'marketing');
        insert into tasks (id, status, active_run_id, assignee_agent_id) values
          ('task-coding', 'todo', null, 'agent-cto'),
          ('task-cognitive', 'todo', null, 'agent-cmo'),
          ('task-inflight', 'in_progress', 'run-1', 'agent-cmo');
      `);

      const migration = createMigrationsV52V52({
        db,
        readAll: <T>(sql: string) => db.prepare(sql).all() as T[],
      })[0];
      migration.fn?.();

      const rows = db.prepare(
        "select id, requires_filesystem as requiresFilesystem from tasks order by id",
      ).all() as Array<{ id: string; requiresFilesystem: number }>;

      expect(rows).toEqual([
        { id: "task-coding", requiresFilesystem: 1 },
        { id: "task-cognitive", requiresFilesystem: 0 },
        { id: "task-inflight", requiresFilesystem: 1 },
      ]);
    } finally {
      db.close();
    }
  });
});
