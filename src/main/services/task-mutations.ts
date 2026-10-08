import type { DatabaseSync } from "node:sqlite";
import { RISK_LEVEL, TASK_STATUS, type TaskPriority } from "../../shared/domain";
import type { CreateTaskInput, DeleteTaskInput, UpdateTaskInput } from "../../shared/commands";
import { AuditService } from "./audit-service";
import { withSavepoint } from "../database/connection";

interface TaskRow {
  id: string;
  title: string;
  description: string;
  status: string;
  assignee_agent_id: string | null;
  project_id: string | null;
  goal_id: string | null;
  workspace_id: string | null;
  priority: TaskPriority;
}

/** Edits, deletion and status moves of existing tasks, with their hierarchy and review rules. */
export class TaskMutations {
  private readonly audit: AuditService;

  constructor(private readonly db: DatabaseSync, private readonly createTask: (input: CreateTaskInput) => string) {
    this.audit = new AuditService(db);
  }

  update(input: UpdateTaskInput): void {
    const now = new Date().toISOString();
    if (input.assigneeAgentId && !this.db.prepare("select 1 from agents where id = ? and org_id = ?").get(input.assigneeAgentId, input.orgId)) {
      throw new Error("Assignee agent was not found.");
    }
    if (input.parentTaskId) this.assertParentAllowed(input.orgId, input.taskId, input.parentTaskId, input.title.trim());
    const result = this.db.prepare(`
      update tasks set title = ?, description = ?, assignee_agent_id = ?, risk = ?, priority = ?, parent_task_id = ?, updated_at = ?,
        stalled_reason = null, run_budget_floor = (select coalesce(max(rowid), 0) from task_runs)
      where id = ? and org_id = ?
    `).run(input.title.trim(), input.description.trim(), input.assigneeAgentId, input.risk, input.priority, input.parentTaskId, now, input.taskId, input.orgId);
    if (result.changes === 0) throw new Error("Task was not found.");
    this.audit.record({
      orgId: input.orgId,
      entityType: "task",
      entityId: input.taskId,
      actorType: "employee",
      actorId: null,
      action: "updated",
      payload: { title: input.title.trim() },
    });
  }

  delete(input: DeleteTaskInput): void {
    const running = this.db.prepare("select 1 from task_runs where task_id = ? and org_id = ? and state = 'running' limit 1")
      .get(input.taskId, input.orgId);
    if (running) throw new Error("This task has a run in progress; wait for it to finish before deleting the task.");
    this.closeReviews(input.orgId, input.taskId, "deleted");
    const result = this.db.prepare("delete from tasks where id = ? and org_id = ?").run(input.taskId, input.orgId);
    if (result.changes === 0) throw new Error("Task was not found.");
    this.audit.record({
      orgId: input.orgId,
      entityType: "task",
      entityId: input.taskId,
      actorType: "employee",
      actorId: null,
      action: "deleted",
      payload: {},
    });
  }

  updateStatus(orgId: string, taskId: string, status: string): void {
    withSavepoint(this.db, "task_status", () => this.applyStatus(orgId, taskId, status));
  }

  private applyStatus(orgId: string, taskId: string, status: string): void {
    const task = this.db.prepare(`
      select id, title, description, status, assignee_agent_id, project_id, goal_id, workspace_id, priority
      from tasks where id = ? and org_id = ?
    `).get(taskId, orgId) as TaskRow | undefined;
    if (!task) throw new Error("Task was not found.");
    if (status === TASK_STATUS.DONE) this.assertNoOpenSubtasks(orgId, task);
    const reopening = task.status === TASK_STATUS.DONE && status !== TASK_STATUS.DONE;
    // Reopening a done task gives it a fresh run budget.
    this.db.prepare(`
      update tasks set status = ?, updated_at = ?,
        stalled_reason = case when ? then null else stalled_reason end,
        run_budget_floor = case when ? then (select coalesce(max(rowid), 0) from task_runs) else run_budget_floor end
      where id = ? and org_id = ?
    `).run(status, new Date().toISOString(), reopening ? 1 : 0, reopening ? 1 : 0, taskId, orgId);
    this.audit.record({
      orgId,
      entityType: "task",
      entityId: taskId,
      actorType: "system",
      actorId: null,
      action: "status_changed",
      payload: { status },
    });
    if (status === TASK_STATUS.REVIEW && task.status !== TASK_STATUS.REVIEW) this.openReview(orgId, task);
    if (task.status === TASK_STATUS.REVIEW && status !== TASK_STATUS.REVIEW) this.closeReviews(orgId, taskId, status);
  }

  /** Hands work in review to the assignee's manager as a review task; without one it waits for the operator. */
  private openReview(orgId: string, task: TaskRow): void {
    const assignee = task.assignee_agent_id
      ? this.db.prepare("select name, manager_agent_id from agents where id = ?").get(task.assignee_agent_id) as { name: string; manager_agent_id: string | null }
      : null;
    const reviewer = assignee?.manager_agent_id
      ? this.db.prepare("select id from agents where id = ? and org_id = ? and lifecycle = 'active'").get(assignee.manager_agent_id, orgId) as { id: string } | undefined
      : undefined;
    if (!reviewer) {
      this.audit.record({ orgId, entityType: "task", entityId: task.id, actorType: "system", actorId: null, action: "review_requested", payload: { reviewer: "operator" } });
      return;
    }
    const author = assignee?.name ?? "The assignee";
    const reviewId = this.createTask({
      orgId,
      title: `Review: ${task.title}`,
      description: [
        `${author} moved "${task.title}" (task_id=${task.id}) to review.`,
        `Task brief:\n${task.description}`,
        `Check the actual output against the brief: read_messages for their report, list_files/read_file and list_documents for what they produced. If it meets the brief, approve it with update_task_status(task_id="${task.id}", status="done"). If not, send it back with update_task_status(task_id="${task.id}", status="in_progress") and tell ${author} in a direct message exactly what to fix. Either verdict closes this review.`,
      ].join("\n\n"),
      status: TASK_STATUS.BACKLOG,
      assigneeAgentId: reviewer.id,
      risk: RISK_LEVEL.LOW,
      projectId: task.project_id,
      goalId: task.goal_id,
      workspaceId: task.workspace_id,
      priority: task.priority,
      requiresFilesystem: false,
      origin: "task_review",
    });
    this.db.prepare("update tasks set review_of_task_id = ? where id = ?").run(task.id, reviewId);
  }

  private closeReviews(orgId: string, taskId: string, verdict: string): void {
    const open = this.db.prepare("select id from tasks where org_id = ? and review_of_task_id = ? and status <> 'done'").all(orgId, taskId) as Array<{ id: string }>;
    for (const review of open) {
      this.db.prepare("update tasks set status = 'done', updated_at = ? where id = ?").run(new Date().toISOString(), review.id);
      this.audit.record({ orgId, entityType: "task", entityId: review.id, actorType: "system", actorId: null, action: "review_closed", payload: { reviewedTaskId: taskId, verdict } });
    }
  }

  private assertParentAllowed(orgId: string, taskId: string, parentTaskId: string, title: string): void {
    if (parentTaskId === taskId) throw new Error(`"${title}" cannot be its own parent.`);
    const parent = this.db.prepare("select title from tasks where id = ? and org_id = ?").get(parentTaskId, orgId) as { title: string } | undefined;
    if (!parent) throw new Error("Parent task was not found.");
    const loop = this.db.prepare(`
      with recursive ancestors(id) as (
        select parent_task_id from tasks where id = ?
        union select t.parent_task_id from tasks t join ancestors a on t.id = a.id where t.parent_task_id is not null
      )
      select 1 from ancestors where id = ? limit 1
    `).get(parentTaskId, taskId);
    if (loop) throw new Error(`"${title}" cannot sit under "${parent.title}": "${parent.title}" is already beneath "${title}".`);
  }

  private assertNoOpenSubtasks(orgId: string, task: TaskRow): void {
    const open = this.db.prepare("select title from tasks where org_id = ? and parent_task_id = ? and status <> 'done' order by created_at")
      .all(orgId, task.id) as Array<{ title: string }>;
    if (open.length === 0) return;
    throw new Error(`"${task.title}" has open subtasks: ${open.map((child) => child.title).join(", ")}. It can close once they are done.`);
  }
}
