import type { DatabaseSync } from "node:sqlite";
import type { SetGoalDueDateInput } from "../../shared/commands";
import { AuditService } from "./audit-service";

/** Sets or clears when a goal is planned to be reached. */
export function setGoalDueDate(db: DatabaseSync, input: SetGoalDueDateInput): void {
  const result = db.prepare("update goals set due_at = ?, updated_at = ? where id = ? and org_id = ?")
    .run(validDueAt(input.dueAt), new Date().toISOString(), input.goalId, input.orgId);
  if (result.changes === 0) throw new Error("Goal was not found.");
  new AuditService(db).record({ orgId: input.orgId, entityType: "goal", entityId: input.goalId, actorType: "employee", actorId: null, action: "due_date_set", payload: { dueAt: input.dueAt } });
}

/** A target date is an exact ISO UTC time on a real calendar day; anything else is refused rather than stored shifted. */
export function validDueAt(dueAt: string | null): string | null {
  if (dueAt === null) return null;
  const exact = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(dueAt);
  const time = new Date(dueAt);
  const normalized = dueAt.length === 20 ? dueAt.replace("Z", ".000Z") : dueAt;
  if (!exact || Number.isNaN(time.getTime()) || time.toISOString() !== normalized) throw new Error(`"${dueAt}" is not a date.`);
  return normalized;
}
