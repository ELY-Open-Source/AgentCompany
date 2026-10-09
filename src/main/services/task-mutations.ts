import type { DatabaseSync } from "node:sqlite";
import { RISK_LEVEL, TASK_STATUS, type TaskPriority } from "../../shared/domain";
import type { CreateTaskInput, DeleteTaskInput, SetTaskBlockedInput, UpdateTaskInput } from "../../shared/commands";
import { AuditService } from "./audit-service";
import { withSavepoint } from "../database/connection";
import { heldWorkTitles } from "./held-deliverables";

type StatusActor = { type: "system" } | { type: "agent"; id: string };

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
  origin: string | null;
}

/** Edits, deletion and status moves of existing tasks, with their hierarchy and review rules. */
export class TaskMutations {
  private readonly audit: AuditService;

  constructor(
    private readonly db: DatabaseSync,
    private readonly createTask: (input: CreateTaskInput) => string,
    /** Asks for a fresh approval when an edit changed content an approval covered. */
    private readonly requestApproval: (orgId: string, taskId: string) => void,
  ) {
    this.audit = new AuditService(db);
  }

  update(input: UpdateTaskInput): void {
    withSavepoint(this.db, "task_update", () => this.applyUpdate(input));
  }

  private applyUpdate(input: UpdateTaskInput): void {
    const now = new Date().toISOString();
    if (input.assigneeAgentId && !this.db.prepare("select 1 from agents where id = ? and org_id = ?").get(input.assigneeAgentId, input.orgId)) {
      throw new Error("Assignee agent was not found.");
    }
    if (input.parentTaskId) this.assertParentAllowed(input.orgId, input.taskId, input.parentTaskId, input.title.trim());
    const before = this.requireTask(input.orgId, input.taskId);
    // Work in review that changes hands goes back to in progress; the new assignee submits it for their own manager's review.
    if (before.status === TASK_STATUS.REVIEW && before.assignee_agent_id !== input.assigneeAgentId) {
      this.applyStatus(input.orgId, before, TASK_STATUS.IN_PROGRESS, { type: "system" }, null);
    }
    const result = this.db.prepare(`
      update tasks set title = ?, description = ?, assignee_agent_id = ?, risk = ?, priority = ?, parent_task_id = ?,
        project_id = ?, goal_id = ?, workspace_id = ?, requires_filesystem = ?, writing_mode = ?, updated_at = ?,
        stalled_reason = null, enqueue_error = null, run_budget_floor = (select coalesce(max(rowid), 0) from task_runs)
      where id = ? and org_id = ?
    `).run(
      input.title.trim(), input.description.trim(), input.assigneeAgentId, input.risk, input.priority, input.parentTaskId,
      input.projectId, input.goalId, input.workspaceId, input.requiresFilesystem ? 1 : 0, input.writingMode, now, input.taskId, input.orgId,
    );
    if (result.changes === 0) throw new Error("Task was not found.");
    this.requestApproval(input.orgId, input.taskId);
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

  /** Blocks the task with a reason (no session starts, queued ones are superseded) or unblocks it with null. */
  setBlocked(input: SetTaskBlockedInput): void {
    const reason = input.reason === null ? null : input.reason.trim();
    if (reason === "") throw new Error("Say why the task is blocked.");
    withSavepoint(this.db, "task_block", () => {
      const result = this.db.prepare("update tasks set blocked_reason = ?, updated_at = ? where id = ? and org_id = ?").run(reason, new Date().toISOString(), input.taskId, input.orgId);
      if (result.changes === 0) throw new Error("Task was not found.");
      if (reason !== null) {
        this.db.prepare(`
          update task_runs set state = 'superseded', completed_at = ?, error_message = ?
          where task_id = ? and org_id = ? and state = 'queued'
        `).run(new Date().toISOString(), `Superseded: the task was blocked (${reason}).`, input.taskId, input.orgId);
      }
      this.audit.record({
        orgId: input.orgId, entityType: "task", entityId: input.taskId, actorType: "employee", actorId: null,
        action: reason === null ? "unblocked" : "blocked", payload: { reason },
      });
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
    withSavepoint(this.db, "task_status", () => this.applyStatus(orgId, this.requireTask(orgId, taskId), status, { type: "system" }, null));
  }

  /** Assignee, managers up the chain or the open reviewer may move a task; finishing needs evidence and a manager's sign-off. */
  agentSetStatus(input: { orgId: string; taskId: string; status: string; agentId: string; evidence: string | null }): string {
    return withSavepoint(this.db, "task_status", () => {
      const task = this.requireTask(input.orgId, input.taskId);
      const isAssignee = task.assignee_agent_id === input.agentId;
      const isManager = this.managesAssignee(input.orgId, input.agentId, task.assignee_agent_id);
      const isReviewer = Boolean(this.db.prepare("select 1 from tasks where review_of_task_id = ? and assignee_agent_id = ? and status <> 'done'").get(task.id, input.agentId));
      if (!isAssignee && !isManager && !isReviewer) {
        const assignee = task.assignee_agent_id ? (this.db.prepare("select name from agents where id = ?").get(task.assignee_agent_id) as { name: string }).name : "the CEO";
        throw new Error(`Only ${assignee}, their managers or the open reviewer can change "${task.title}".`);
      }
      const held = input.status === TASK_STATUS.DONE ? heldWorkTitles(this.db, { taskId: task.id }) : [];
      if (held.length > 0) throw new Error(`"${task.title}" has work awaiting board review (${held.join(", ")}); it is not written yet, so the task cannot be done.`);
      const finishing = input.status === TASK_STATUS.DONE || input.status === TASK_STATUS.REVIEW;
      if (finishing && !input.evidence) {
        throw new Error('"evidence" is required to move work to review or done: say what was produced and where (file_ids, document ids, test results).');
      }
      // Plain work its own assignee calls done goes to the manager first; vehicles (reviews, chat replies) close directly.
      const needsSignOff = input.status === TASK_STATUS.DONE && task.status !== TASK_STATUS.DONE && task.origin === null
        && isAssignee && this.activeManagerOf(input.orgId, task.assignee_agent_id) !== null;
      const applied = needsSignOff ? TASK_STATUS.REVIEW : input.status;
      this.applyStatus(input.orgId, task, applied, { type: "agent", id: input.agentId }, input.evidence);
      return applied;
    });
  }

  private requireTask(orgId: string, taskId: string): TaskRow {
    const task = this.db.prepare(`
      select id, title, description, status, assignee_agent_id, project_id, goal_id, workspace_id, priority, origin
      from tasks where id = ? and org_id = ?
    `).get(taskId, orgId) as TaskRow | undefined;
    if (!task) throw new Error("Task was not found.");
    return task;
  }

  /** True when the agent sits above the assignee in the management chain; unassigned work belongs to the CEO. */
  private managesAssignee(orgId: string, agentId: string, assigneeId: string | null): boolean {
    if (!assigneeId) return Boolean(this.db.prepare("select 1 from agents where id = ? and org_id = ? and role_level = 'c_suite'").get(agentId, orgId));
    return Boolean(this.db.prepare(`
      with recursive chain(id) as (
        select manager_agent_id from agents where id = ? and org_id = ?
        union select a.manager_agent_id from agents a join chain c on a.id = c.id where a.manager_agent_id is not null
      )
      select 1 from chain where id = ? limit 1
    `).get(assigneeId, orgId, agentId));
  }

  private activeManagerOf(orgId: string, agentId: string | null): string | null {
    if (!agentId) return null;
    const row = this.db.prepare(`
      select m.id from agents a join agents m on m.id = a.manager_agent_id
      where a.id = ? and a.org_id = ? and m.lifecycle = 'active'
    `).get(agentId, orgId) as { id: string } | undefined;
    return row?.id ?? null;
  }

  private applyStatus(orgId: string, task: TaskRow, status: string, actor: StatusActor, evidence: string | null): void {
    const taskId = task.id;
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
      actorType: actor.type,
      actorId: actor.type === "agent" ? actor.id : null,
      action: "status_changed",
      payload: evidence ? { status, evidence } : { status },
    });
    if (status === TASK_STATUS.REVIEW && task.status !== TASK_STATUS.REVIEW) this.openReview(orgId, task, evidence);
    if (task.status === TASK_STATUS.REVIEW && status !== TASK_STATUS.REVIEW) this.closeReviews(orgId, taskId, status);
  }

  /** Hands work in review to the assignee's manager as a review task; without one it waits for the operator. */
  private openReview(orgId: string, task: TaskRow, evidence: string | null): void {
    const assignee = task.assignee_agent_id
      ? this.db.prepare("select name from agents where id = ?").get(task.assignee_agent_id) as { name: string }
      : null;
    const reviewerId = this.activeManagerOf(orgId, task.assignee_agent_id);
    if (!reviewerId) {
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
        `Evidence given: ${evidence ?? "none; ask for it"}`,
        `Check the actual output against the brief: read_messages for their report, list_files/read_file and list_documents for what they produced. If it meets the brief, approve it with update_task_status(task_id="${task.id}", status="done", evidence="what you checked"). If not, send it back with update_task_status(task_id="${task.id}", status="in_progress") and tell ${author} in a direct message exactly what to fix. Either verdict closes this review.`,
      ].join("\n\n"),
      status: TASK_STATUS.BACKLOG,
      assigneeAgentId: reviewerId,
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
