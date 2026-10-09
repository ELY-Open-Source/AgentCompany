import type { DatabaseSync } from "node:sqlite";
import { TASK_STATUS } from "../../shared/domain";
import { OrganizationService } from "./organization-service";

/** A chat-wake task only carries its reply run, so the run ending closes it; left open it would strand forever. */
export function closeChatWakeTask(db: DatabaseSync, orgId: string, runId: string): void {
  const run = db.prepare("select r.task_id, t.origin from task_runs r join tasks t on t.id = r.task_id where r.id = ? and r.org_id = ?")
    .get(runId, orgId) as { task_id: string; origin: string | null } | undefined;
  if (!run || run.origin !== "chat_wake") return;
  const task = db.prepare("select status from tasks where id = ? and org_id = ?")
    .get(run.task_id, orgId) as { status: string } | undefined;
  if (!task || (task.status !== TASK_STATUS.BACKLOG && task.status !== TASK_STATUS.IN_PROGRESS)) return;
  new OrganizationService(db).updateTaskStatus(orgId, run.task_id, TASK_STATUS.DONE);
}
