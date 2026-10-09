import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS } from "../../src/shared/domain";

/** Copies a row many times with new ids and later times, as a busy company would produce. */
function copies(db: DatabaseSync, table: string, id: string, count: number): void {
  const columns = (db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name);
  const insert = db.prepare(`insert into ${table}(${columns.join(", ")}) select ${columns.map((column) => (column === "id" ? "?" : column === "created_at" ? "?" : column)).join(", ")} from ${table} where id = ?`);
  for (let index = 0; index < count; index += 1) {
    insert.run(`${id}_copy_${index}`, new Date(Date.now() + 60_000 + index).toISOString(), id);
  }
}

describe("snapshot history windows", () => {
  test("are cut within the shown company, so another company's activity never pushes its history out", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-org-windows-${randomUUID()}.db`));
    const db = connection.db;
    const organization = new OrganizationService(db);
    const chat = new ChatService(db);
    const quiet = { orgId: "", employeeId: "", spaceId: "", messageId: "", taskId: "" };
    const busy = { orgId: "", employeeId: "", spaceId: "", messageId: "", taskId: "" };
    for (const company of [quiet, busy]) {
      connection.transaction(() => {
        company.orgId = organization.createOrganization({ organizationName: `Co ${randomUUID().slice(0, 4)}`, employeeName: "Dana", mission: "m", goal: "g" });
        company.employeeId = (db.prepare("select id from employees where org_id = ?").get(company.orgId) as { id: string }).id;
        company.spaceId = (db.prepare("select id from chat_spaces where org_id = ? and name = 'general'").get(company.orgId) as { id: string }).id;
        company.messageId = chat.sendMessage({ orgId: company.orgId, spaceId: company.spaceId, threadId: null, senderType: "employee", senderId: company.employeeId, bodyMd: "status update", attachmentFileIds: [] });
        company.taskId = organization.createTask({
          orgId: company.orgId, title: "Work", description: "d", status: TASK_STATUS.BACKLOG, assigneeAgentId: null, risk: RISK_LEVEL.LOW,
          projectId: null, goalId: null, workspaceId: null, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: false,
        });
      });
    }
    db.prepare("insert into task_runs(id, org_id, task_id, trigger, state, created_at) values ('run_quiet', ?, ?, 'manual', 'completed', ?)").run(quiet.orgId, quiet.taskId, new Date().toISOString());
    db.prepare("insert into task_runs(id, org_id, task_id, trigger, state, created_at) values ('run_busy', ?, ?, 'manual', 'completed', ?)").run(busy.orgId, busy.taskId, new Date().toISOString());
    db.prepare("insert into chat_mentions(message_id, target_type, target_id, offset_start, offset_end) values (?, 'employee', ?, 0, 6)").run(quiet.messageId, quiet.employeeId);
    // The busy company is newer in everything than the quiet one.
    copies(db, "chat_messages", busy.messageId, 600);
    copies(db, "task_runs", "run_busy", 250);
    organization.setActiveOrganization(quiet.orgId);

    const snapshot = new SnapshotService(db).load();
    expect(snapshot.chatMessages.map((message) => message.id)).toContain(quiet.messageId);
    expect(snapshot.chatMessages.every((message) => message.orgId === quiet.orgId)).toBe(true);
    expect(snapshot.taskRuns.map((run) => run.id)).toEqual(["run_quiet"]);
    expect(snapshot.chatMentions.map((mention) => mention.messageId)).toEqual([quiet.messageId]);
    expect(snapshot.chatThreads.map((thread) => thread.orgId)).not.toContain(busy.orgId);
    connection.close();
  });
});
