import type { TaskDeleteImpact } from "../../shared/domain";
import type { DatabaseSync } from "node:sqlite";
import { APPROVAL_STATE, RISK_LEVEL, TASK_STATUS, WRITING_MODE, type RiskLevel } from "../../shared/domain";
import { createId } from "../../shared/ids";
import type { CreateAgentInput, CreateGoalInput, CreateOrganizationInput, CreateProjectInput, CreateTaskInput, CreateWorkspaceInput, DeleteTaskInput, SetTaskBlockedInput, UpdateAgentInput, UpdateEmployeeProfileInput, UpdateTaskInput } from "../../shared/commands";
import { AuditService } from "./audit-service";
import { ensureAgentHeartbeat, resolveGoalKickoff, type GoalKickoffPlan } from "./goal-kickoff";
import { PolicyService } from "./policy-service";
import { OrgGovernanceService } from "./org-governance-service";
import { assertUsableMentionName } from "../../shared/mention-handles";
import { seedOrganization } from "./organization-seed";
import { TaskMutations } from "./task-mutations";
import { normalizeAvatarColor, normalizeAvatarImage } from "./avatar-values";
import { approvalDecision, autonomy } from "./org-approvals";
import { admitAgent } from "./agent-admission";
import { HOST_ACCESS_NOTE, TASK_APPROVAL_KINDS_SQL, TASK_SNAPSHOT_SQL } from "./task-approval";

export class OrganizationService {
  private readonly audit: AuditService;
  private readonly policy: PolicyService;
  private readonly governance: OrgGovernanceService;
  private readonly tasks: TaskMutations;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
    this.policy = new PolicyService(db);
    this.governance = new OrgGovernanceService(db);
    this.tasks = new TaskMutations(db, (input) => this.createTask(input), (orgId, taskId) => this.requestTaskApproval(orgId, taskId));
  }

  createOrganization(input: CreateOrganizationInput): string {
    return seedOrganization(this.db, input);
  }

  setActiveOrganization(orgId: string): void {
    const row = this.db.prepare("select id from organizations where id = ?").get(orgId) as { id: string } | undefined;
    if (!row) throw new Error("Organization was not found.");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into app_state(id, active_org_id, updated_at)
      values (1, ?, ?)
      on conflict(id) do update set active_org_id = excluded.active_org_id, updated_at = excluded.updated_at
    `).run(orgId, now);
    this.audit.record({
      orgId,
      entityType: "app_state",
      entityId: "active_org",
      actorType: "employee",
      actorId: null,
      action: "switched",
      payload: { orgId },
    });
  }

  /**
   * The global handbrake: while paused, the autonomous queue stops enqueuing
   * and claiming runs (the run already in flight finishes). Survives
   * restarts, so a runaway conversation stays stopped until the operator
   * resumes it.
   */
  setAutonomousPaused(paused: boolean): void {
    this.db.prepare(`
      insert into app_state(id, active_org_id, autorun_paused, updated_at)
      values (1, null, ?, ?)
      on conflict(id) do update set autorun_paused = excluded.autorun_paused, updated_at = excluded.updated_at
    `).run(paused ? 1 : 0, new Date().toISOString());
  }

  updateUiPreferences(input: { theme?: "system" | "light" | "dark"; language?: "en" | "zh" }): void {
    const current = this.db.prepare("select theme, language from app_state where id = 1")
      .get() as { theme: string; language: string } | undefined;
    const theme = input.theme ?? current?.theme ?? "system";
    const language = input.language ?? current?.language ?? "en";
    this.db.prepare(`
      insert into app_state(id, active_org_id, theme, language, updated_at)
      values (1, null, ?, ?, ?)
      on conflict(id) do update set theme = excluded.theme, language = excluded.language, updated_at = excluded.updated_at
    `).run(theme, language, new Date().toISOString());
  }

  deleteOrganization(orgId: string): void {
    const row = this.db.prepare("select id from organizations where id = ?")
      .get(orgId) as { id: string } | undefined;
    if (!row) throw new Error("Organization was not found.");
    this.db.prepare("delete from organizations where id = ?").run(orgId);
    const nextActive = this.db.prepare("select id from organizations order by created_at asc limit 1")
      .get() as { id: string } | undefined;
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into app_state(id, active_org_id, updated_at)
      values (1, ?, ?)
      on conflict(id) do update set active_org_id = excluded.active_org_id, updated_at = excluded.updated_at
    `).run(nextActive?.id ?? null, now);
  }

  createAgent(input: CreateAgentInput): string {
    assertUsableMentionName(input.name);
    this.assertAgentNameAvailable(input.orgId, input.name, null);
    this.governance.assertRank(input.orgId, null, input.roleLevel ?? "staff");
    const hiringPolicy = this.governance.enforceHiringPolicy(input);
    const id = createId("agt");
    const now = new Date().toISOString();
    const autoApprove = autonomy(this.db, input.orgId).autoApproveHires;
    const review = hiringPolicy.reviewRequired ? approvalDecision(this.db, input.orgId, autoApprove, now) : null;
    // A hire waiting for review is not on staff: no runs, no channels, no service identity until approved.
    const waitsForReview = review?.state === APPROVAL_STATE.PENDING;
    this.db.prepare(`
      insert into agents(
        id, org_id, name, role, department, model_provider_id, model_id,
        budget_cents, manager_agent_id, title, role_level, model_strategy,
        workspace_id, heartbeat_enabled, heartbeat_interval_sec, lifecycle, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.orgId,
      input.name.trim(),
      input.role.trim(),
      hiringPolicy.departmentName,
      input.modelProviderId,
      input.modelId,
      input.budgetCents,
      input.managerAgentId,
      input.title?.trim() || input.role.trim(),
      input.roleLevel ?? "staff",
      input.modelStrategy ?? "pooled",
      input.workspaceId ?? null,
      input.heartbeatEnabled === true ? 1 : 0,
      input.heartbeatIntervalSec ?? 0,
      waitsForReview ? "pending_hire" : "active",
      now,
    );
    this.audit.record({
      orgId: input.orgId,
      entityType: "agent",
      entityId: id,
      actorType: "system",
      actorId: null,
      action: "created",
      payload: { role: input.role, department: hiringPolicy.departmentName },
    });
    if (waitsForReview) console.info(`[hiring] ${input.name.trim()} (${id}) awaits hire approval`);
    else admitAgent(this.db, input.orgId, id, input.name, now);
    if (review) {
      const approvalId = createId("app");
      this.db.prepare(`
        insert into approvals(
          id, org_id, kind, title, details, risk, requested_by_type,
          requested_by_id, source_entity_type, source_entity_id, state, decided_by_employee_id, created_at, decided_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        approvalId,
        input.orgId,
        "agent_hire",
        `Review hire: ${input.name.trim()}`,
        `Department: ${hiringPolicy.departmentName}\nRole: ${input.role.trim()}\nBudget: ${input.budgetCents}`,
        RISK_LEVEL.MEDIUM,
        "system",
        null,
        "agent",
        id,
        review.state,
        review.decidedBy,
        now,
        review.decidedAt,
      );
      this.settleApproval(input.orgId, approvalId, "agent_hire", RISK_LEVEL.MEDIUM, autoApprove);
    }
    this.kickoffUntouchedGoals(input.orgId);
    return id;
  }

  updateAgent(input: UpdateAgentInput): void {
    const agent = this.db.prepare("select id, name, avatar_emoji, avatar_color, avatar_image from agents where id = ? and org_id = ?")
      .get(input.agentId, input.orgId) as { id: string; name: string; avatar_emoji: string | null; avatar_color: string | null; avatar_image: string | null } | undefined;
    if (!agent) throw new Error("Agent was not found.");
    const role = input.role.trim();
    if (!role) throw new Error("Agent role is required.");
    const name = input.name === undefined ? agent.name : input.name.trim();
    if (!name) throw new Error("Agent name is required.");
    if (name !== agent.name) {
      assertUsableMentionName(name);
      this.assertAgentNameAvailable(input.orgId, name, input.agentId);
    }
    if (input.modelProviderId) {
      const provider = this.db.prepare("select id from providers where id = ? and org_id = ?")
        .get(input.modelProviderId, input.orgId) as { id: string } | undefined;
      if (!provider) throw new Error("Agent provider was not found.");
    }
    this.governance.assertRank(input.orgId, input.agentId, input.roleLevel.trim() || "staff");
    const department = this.governance.requireCanonicalDepartment(input.orgId, input.department);
    const budgetCents = Math.max(0, Math.round(input.budgetCents));
    this.governance.enforceStaffingChange({ orgId: input.orgId, agentId: input.agentId, departmentName: department, budgetCents });
    const avatarEmoji = input.avatarEmoji === undefined ? agent.avatar_emoji : (input.avatarEmoji.trim() || null);
    const avatarColor = input.avatarColor === undefined ? agent.avatar_color : normalizeAvatarColor(input.avatarColor);
    const avatarImage = input.avatarImage === undefined ? agent.avatar_image : normalizeAvatarImage(input.avatarImage);
    const result = this.db.prepare(`
      update agents
      set name = ?, role = ?, title = ?, role_level = ?, department = ?, budget_cents = ?, model_provider_id = ?, model_id = ?,
          avatar_emoji = ?, avatar_color = ?, avatar_image = ?
      where id = ? and org_id = ?
    `).run(name, role, input.title.trim() || role, input.roleLevel.trim() || "staff", department, budgetCents, input.modelProviderId, input.modelId, avatarEmoji, avatarColor, avatarImage, input.agentId, input.orgId);
    if (result.changes === 0) throw new Error("Agent update failed.");
    this.audit.record({
      orgId: input.orgId,
      entityType: "agent",
      entityId: input.agentId,
      actorType: "employee",
      actorId: null,
      action: "updated",
      payload: { name, role, roleLevel: input.roleLevel.trim() || "staff" },
    });
  }

  updateEmployeeProfile(input: UpdateEmployeeProfileInput): void {
    const employee = this.db.prepare("select id, avatar_emoji, avatar_color, avatar_image from employees where id = ? and org_id = ?")
      .get(input.employeeId, input.orgId) as { id: string; avatar_emoji: string | null; avatar_color: string | null; avatar_image: string | null } | undefined;
    if (!employee) throw new Error("Employee was not found.");
    const displayName = input.displayName.trim();
    if (!displayName) throw new Error("Display name is required.");
    const avatarEmoji = input.avatarEmoji === undefined ? employee.avatar_emoji : (input.avatarEmoji.trim() || null);
    const avatarColor = input.avatarColor === undefined ? employee.avatar_color : normalizeAvatarColor(input.avatarColor);
    const avatarImage = input.avatarImage === undefined ? employee.avatar_image : normalizeAvatarImage(input.avatarImage);
    this.db.prepare("update employees set display_name = ?, avatar_emoji = ?, avatar_color = ?, avatar_image = ? where id = ? and org_id = ?")
      .run(displayName, avatarEmoji, avatarColor, avatarImage, input.employeeId, input.orgId);
    this.audit.record({
      orgId: input.orgId,
      entityType: "employee",
      entityId: input.employeeId,
      actorType: "employee",
      actorId: input.employeeId,
      action: "profile_updated",
      payload: { displayName },
    });
  }

  createTask(input: CreateTaskInput): string {
    const id = createId("tsk");
    const now = new Date().toISOString();
    this.verifyOptionalOrgEntity("agents", input.assigneeAgentId, input.orgId, "Assignee agent");
    this.verifyOptionalOrgEntity("goals", input.goalId, input.orgId, "Goal");
    this.verifyOptionalOrgEntity("workspaces", input.workspaceId, input.orgId, "Workspace");
    this.verifyProject(input.projectId, input.goalId, input.orgId);

    this.db.prepare(`
      insert into tasks(
        id, org_id, title, description, status, assignee_agent_id, risk,
        project_id, goal_id, workspace_id, priority, requires_filesystem, writing_mode, origin, created_at, updated_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.orgId,
      input.title.trim(),
      input.description.trim(),
      input.status,
      input.assigneeAgentId,
      input.risk,
      input.projectId,
      input.goalId,
      input.workspaceId,
      input.priority,
      input.requiresFilesystem ? 1 : 0,
      input.writingMode ?? WRITING_MODE.CONVERSATIONAL,
      input.origin ?? null,
      now,
      now,
    );
    const policy = this.policy.evaluateTaskCreation(input.orgId, input.risk);
    this.requestTaskApproval(input.orgId, id);
    this.audit.record({
      orgId: input.orgId,
      entityType: "task",
      entityId: id,
      actorType: "system",
      actorId: null,
      action: "created",
      payload: { status: TASK_STATUS.BACKLOG, policyRuleId: policy.matchedRuleId },
    });
    return id;
  }

  /** Asks for approval of a task's current content when policy or file access needs it and no review already covers that content. */
  requestTaskApproval(orgId: string, taskId: string): void {
    const task = this.db.prepare(`select t.title, t.description, t.risk, t.requires_filesystem, ${TASK_SNAPSHOT_SQL} as snapshot from tasks t where t.id = ? and t.org_id = ?`)
      .get(taskId, orgId) as { title: string; description: string; risk: RiskLevel; requires_filesystem: number; snapshot: string };
    const policy = this.policy.evaluateTaskCreation(orgId, task.risk);
    if (!policy.approvalRequired && task.requires_filesystem !== 1) return;
    const latest = this.db.prepare(`
      select subject_snapshot from approvals
      where org_id = ? and source_entity_type = 'task' and source_entity_id = ? and kind in ${TASK_APPROVAL_KINDS_SQL}
      order by rowid desc limit 1
    `).get(orgId, taskId) as { subject_snapshot: string | null } | undefined;
    if (latest?.subject_snapshot === task.snapshot) return;
    const superseded = this.db.prepare(`
      update approvals set state = ? where org_id = ? and source_entity_type = 'task' and source_entity_id = ? and kind in ${TASK_APPROVAL_KINDS_SQL} and state = ?
    `).run(APPROVAL_STATE.SUPERSEDED, orgId, taskId, APPROVAL_STATE.PENDING);
    if (superseded.changes > 0) console.info(`[approvals] task ${taskId} changed; its pending review was superseded`);
    const now = new Date().toISOString();
    const approvalId = createId("app");
    const approvalKind = policy.approvalRequired ? "task_risk" : "task_execution";
    const autoApprove = autonomy(this.db, orgId).executionMode === "ai_ceo";
    const decision = approvalDecision(this.db, orgId, autoApprove, now);
    this.db.prepare(`
      insert into approvals(
        id, org_id, kind, title, details, risk, requested_by_type, requested_by_id, source_entity_type, source_entity_id,
        state, decided_by_employee_id, created_at, decided_at, subject_snapshot
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(approvalId, orgId, approvalKind, task.title, task.requires_filesystem === 1 ? `${task.description}\n\n${HOST_ACCESS_NOTE}` : task.description, RISK_LEVEL.HIGH, "system", null, "task", taskId,
      decision.state, decision.decidedBy, now, decision.decidedAt, task.snapshot);
    this.settleApproval(orgId, approvalId, approvalKind, RISK_LEVEL.HIGH, autoApprove);
  }

  /** Routes a pending approval to its decider, or records the auto-approval in the audit trail. */
  private settleApproval(orgId: string, approvalId: string, kind: string, risk: typeof RISK_LEVEL[keyof typeof RISK_LEVEL], autoApproved: boolean): void {
    if (!autoApproved) {
      this.governance.routeApproval({ orgId, approvalId, kind, risk });
      return;
    }
    this.audit.record({
      orgId,
      entityType: "approval",
      entityId: approvalId,
      actorType: "system",
      actorId: null,
      action: "approved",
      payload: { kind, auto: true },
    });
  }

  private verifyOptionalOrgEntity(table: "agents" | "goals" | "workspaces", id: string | null, orgId: string, label: string): void {
    if (!id) return;
    const row = this.db.prepare(`select id from ${table} where id = ? and org_id = ?`).get(id, orgId);
    if (!row) throw new Error(`${label} was not found.`);
  }

  private verifyProject(projectId: string | null, goalId: string | null, orgId: string): void {
    if (!projectId) return;
    const project = this.db.prepare("select goal_id from projects where id = ? and org_id = ?")
      .get(projectId, orgId) as { goal_id: string | null } | undefined;
    if (!project) throw new Error("Project was not found.");
    if (goalId && project.goal_id !== goalId) throw new Error("Project is linked to a different goal.");
  }

  /**
   * Agent names are identities: @mentions, DM routing, and task assignment
   * all resolve by name, so two active agents must never share one.
   */
  private assertAgentNameAvailable(orgId: string, name: string, exceptAgentId: string | null): void {
    const clash = this.db.prepare(`
      select id from agents
      where org_id = ? and lifecycle in ('active', 'pending_hire') and lower(name) = lower(?) and (? is null or id <> ?)
      limit 1
    `).get(orgId, name.trim(), exceptAgentId, exceptAgentId) as { id: string } | undefined;
    if (clash) throw new Error(`An agent named "${name.trim()}" is already on staff or awaiting approval. Pick a different name.`);
  }

  createGoal(input: CreateGoalInput): string {
    const id = createId("gol");
    const now = new Date().toISOString();
    if (input.ownerAgentId) this.verifyOptionalOrgEntity("agents", input.ownerAgentId, input.orgId, "Owner agent");
    this.db.prepare(`
      insert into goals(id, org_id, title, description, status, owner_agent_id, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.orgId, input.title.trim(), input.description.trim(), "active", input.ownerAgentId, now, now);
    this.audit.record({
      orgId: input.orgId,
      entityType: "goal",
      entityId: id,
      actorType: "employee",
      actorId: null,
      action: "created",
      payload: { title: input.title.trim() },
    });
    const plan = resolveGoalKickoff(this.db, {
      orgId: input.orgId,
      goalTitle: input.title,
      goalDescription: input.description,
      ownerAgentId: input.ownerAgentId,
    });
    if (plan) this.createKickoffTask(input.orgId, id, plan);
    return id;
  }

  /**
   * Materializes a goal's kickoff plan as a first-class task: it passes the
   * same policy/approval gates as any other task and wakes the assignee.
   */
  private createKickoffTask(orgId: string, goalId: string, plan: GoalKickoffPlan): string {
    ensureAgentHeartbeat(this.db, orgId, plan.assigneeAgentId);
    return this.createTask({
      orgId,
      title: plan.title,
      description: plan.description,
      status: TASK_STATUS.BACKLOG,
      assigneeAgentId: plan.assigneeAgentId,
      risk: RISK_LEVEL.MEDIUM,
      projectId: null,
      goalId,
      workspaceId: plan.workspaceId,
      priority: "high",
      requiresFilesystem: plan.workspaceId !== null,
    });
  }

  /**
   * Goals created before any agent existed (or whose owner was archived)
   * have no kickoff task yet; the moment an agent joins, each untouched
   * active goal is operationalized so no goal stays inert.
   */
  private kickoffUntouchedGoals(orgId: string): void {
    const goals = this.db.prepare(`
      select id, title, description, owner_agent_id
      from goals g
      where g.org_id = ? and g.status = 'active'
        and not exists (select 1 from tasks t where t.goal_id = g.id)
    `).all(orgId) as Array<{ id: string; title: string; description: string; owner_agent_id: string | null }>;
    for (const goal of goals) {
      const plan = resolveGoalKickoff(this.db, {
        orgId,
        goalTitle: goal.title,
        goalDescription: goal.description,
        ownerAgentId: goal.owner_agent_id,
      });
      if (plan) this.createKickoffTask(orgId, goal.id, plan);
    }
  }

  createProject(input: CreateProjectInput): string {
    const id = createId("prj");
    const now = new Date().toISOString();
    if (input.goalId) this.verifyOptionalOrgEntity("goals", input.goalId, input.orgId, "Goal");
    if (input.leadAgentId) this.verifyOptionalOrgEntity("agents", input.leadAgentId, input.orgId, "Lead agent");
    this.db.prepare(`
      insert into projects(id, org_id, goal_id, name, description, lead_agent_id, status, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.orgId, input.goalId, input.name.trim(), input.description.trim(), input.leadAgentId, "in_progress", now, now);
    this.audit.record({
      orgId: input.orgId,
      entityType: "project",
      entityId: id,
      actorType: "employee",
      actorId: null,
      action: "created",
      payload: { name: input.name.trim() },
    });
    return id;
  }

  createWorkspace(input: CreateWorkspaceInput): string {
    const id = createId("wsp");
    const now = new Date().toISOString();
    if (input.projectId) this.verifyProject(input.projectId, null, input.orgId);
    this.db.prepare(`
      insert into workspaces(id, org_id, name, local_path, repo_url, repo_ref, project_id, is_primary, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.orgId, input.name.trim(), input.localPath.trim(), "", "", input.projectId, 0, now, now);
    this.audit.record({
      orgId: input.orgId,
      entityType: "workspace",
      entityId: id,
      actorType: "employee",
      actorId: null,
      action: "created",
      payload: { name: input.name.trim() },
    });
    return id;
  }

  updateTask(input: UpdateTaskInput): void {
    this.verifyOptionalOrgEntity("goals", input.goalId, input.orgId, "Goal");
    this.verifyOptionalOrgEntity("workspaces", input.workspaceId, input.orgId, "Workspace");
    this.verifyProject(input.projectId, input.goalId, input.orgId);
    this.tasks.update(input);
  }

  taskDeleteImpact(orgId: string, taskId: string): TaskDeleteImpact {
    return this.tasks.deleteImpact(orgId, taskId);
  }

  setTaskBlocked(input: SetTaskBlockedInput): void {
    this.tasks.setBlocked(input);
  }

  deleteTask(input: DeleteTaskInput): void {
    this.tasks.delete(input);
  }

  updateTaskStatus(orgId: string, taskId: string, status: string): void {
    this.tasks.updateStatus(orgId, taskId, status);
  }

  agentSetTaskStatus(input: { orgId: string; taskId: string; status: string; agentId: string; evidence: string | null }): string {
    return this.tasks.agentSetStatus(input);
  }
}
