import type { DatabaseSync } from "node:sqlite";
import type { CreateSprintInput, DeleteSprintInput } from "../../shared/commands";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";

export class SprintService {
  private readonly audit: AuditService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
  }

  create(input: CreateSprintInput): string {
    const id = createId("spr");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into sprints(id, org_id, name, goal, status, start_date, end_date, velocity_points, completed_points, retrospective, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)
    `).run(id, input.orgId, input.name.trim(), input.goal.trim(), "planned", input.startDate, input.endDate, "", now, now);
    this.audit.record({
      orgId: input.orgId,
      entityType: "sprint",
      entityId: id,
      actorType: "system",
      actorId: null,
      action: "created",
      payload: { name: input.name.trim() },
    });
    return id;
  }

  delete(input: DeleteSprintInput): void {
    const result = this.db.prepare("delete from sprints where id = ? and org_id = ?").run(input.sprintId, input.orgId);
    if (result.changes === 0) throw new Error("Sprint was not found.");
  }
}
