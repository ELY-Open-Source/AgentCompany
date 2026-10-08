import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { hostAccessNoteSchema } from "../../src/main/database/migrations/088-host-access-note";
import { HOST_ACCESS_NOTE } from "../../src/main/services/task-approval";

describe("host access note migration", () => {
  test("pending file-access approvals from before the warning get it; others stay as they were", () => {
    const db = new DatabaseSync(join(tmpdir(), `agentcompany-host-note-${randomUUID()}.db`));
    db.exec(`
      create table schema_migrations(version integer primary key, name text not null, applied_at text not null);
      create table tasks(id text primary key, requires_filesystem integer not null);
      create table approvals(id text primary key, kind text not null, state text not null, details text not null, source_entity_type text, source_entity_id text);
      insert into tasks values ('tsk_fs', 1), ('tsk_plain', 0);
      insert into approvals values
        ('app_pending', 'task_execution', 'pending', 'Make CI green.', 'task', 'tsk_fs'),
        ('app_decided', 'task_execution', 'approved', 'Old.', 'task', 'tsk_fs'),
        ('app_plain', 'task_risk', 'pending', 'Risky.', 'task', 'tsk_plain');
    `);
    db.exec(hostAccessNoteSchema);
    const details = Object.fromEntries((db.prepare("select id, details from approvals").all() as Array<{ id: string; details: string }>).map((row) => [row.id, row.details]));
    expect(details).toEqual({ app_pending: `Make CI green.\n\n${HOST_ACCESS_NOTE}`, app_decided: "Old.", app_plain: "Risky." });
  });
});
