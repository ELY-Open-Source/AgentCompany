import type { DatabaseSync } from "node:sqlite";
import { createId } from "../../shared/ids";

/** Records a verdict on a plain task (one the system did not create for itself); internal vehicles are not work. */
export function recordWorkVerdict(db: DatabaseSync, input: { orgId: string; taskId: string; origin: string | null; verdict: "accepted" | "returned" }): void {
  if (input.origin !== null) return;
  db.prepare("insert into work_verdicts(id, org_id, task_id, verdict, at) values (?, ?, ?, ?, ?)")
    .run(createId("wv"), input.orgId, input.taskId, input.verdict, new Date().toISOString());
}
