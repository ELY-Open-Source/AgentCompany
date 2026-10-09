import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { workVerdictsSchema } from "../../src/main/database/migrations/103-work-verdicts";

describe("past verdicts on work", () => {
  test("are read once from the audit trail: kind known, done once, a decline and its reopen counted once", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-verdict-backfill-${randomUUID()}.db`));
    const db = connection.db;
    let orgId = "";
    connection.transaction(() => {
      orgId = new OrganizationService(db).createOrganization({ organizationName: "Acme", employeeName: "Yang", mission: "m", goal: "g" });
    });
    const task = (id: string, origin: string | null) => db.prepare("insert into tasks(id, org_id, title, description, status, risk, priority, requires_filesystem, writing_mode, origin, created_at, updated_at) values (?, ?, ?, 'd', 'backlog', 'low', 'normal', 0, 'conversational', ?, ?, ?)")
      .run(id, orgId, id, origin, "2026-05-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z");
    let n = 0;
    const event = (taskId: string, status: string, at: string) => db.prepare("insert into audit_events(id, org_id, entity_type, entity_id, actor_type, actor_id, action, payload_json, created_at) values (?, ?, 'task', ?, 'system', null, 'status_changed', ?, ?)")
      .run(`aud_${n++}`, orgId, taskId, JSON.stringify({ status }), at);
    task("tsk_plain", null);
    task("tsk_wake", "chat_wake");
    event("tsk_plain", "review", "2026-05-02T00:00:00.000Z");
    event("tsk_plain", "done", "2026-05-02T01:00:00.000Z");
    event("tsk_plain", "done", "2026-05-02T02:00:00.000Z");
    event("tsk_wake", "done", "2026-05-02T03:00:00.000Z");
    event("tsk_gone", "done", "2026-05-02T04:00:00.000Z");
    // A decline reopened the plain task a moment after it was decided.
    db.prepare("insert into approvals(id, org_id, kind, title, details, risk, requested_by_type, requested_by_id, source_entity_type, source_entity_id, state, decided_by_employee_id, created_at, decided_at) values ('app_d', ?, 'deliverable_review', 't', 'd', 'low', 'system', null, 'held_deliverable', 'held_1', 'declined', null, ?, ?)")
      .run(orgId, "2026-05-03T00:00:00.000Z", "2026-05-03T00:00:00.000Z");
    db.prepare("insert into held_deliverables(id, org_id, approval_id, kind, task_id, content, state, created_at) values ('held_1', ?, 'app_d', 'file', 'tsk_plain', 'x', 'declined', ?)")
      .run(orgId, "2026-05-03T00:00:00.000Z");
    event("tsk_plain", "in_progress", "2026-05-03T00:00:00.500Z");
    db.exec("delete from work_verdicts");
    db.exec(workVerdictsSchema.slice(0, workVerdictsSchema.indexOf("insert into schema_migrations")));
    expect(db.prepare("select task_id, verdict from work_verdicts order by at").all()).toEqual([
      { task_id: "tsk_plain", verdict: "accepted" },
      { task_id: "tsk_plain", verdict: "returned" },
    ]);
    connection.close();
  });
});
