import type { DatabaseSync } from "node:sqlite";
import { APPROVAL_STATE, RISK_LEVEL, TASK_STATUS, type ApprovalState } from "../../shared/domain";
import { createId } from "../../shared/ids";
import type { CreateAgentInput, CreateGoalInput, CreateOrganizationInput, CreateProjectInput, CreateTaskInput, CreateWorkspaceInput, DeleteTaskInput, UpdateAgentInput, UpdateEmployeeProfileInput, UpdateTaskInput } from "../../shared/commands";
import { AuditService } from "./audit-service";
import { ensureAgentHeartbeat, resolveGoalKickoff, type GoalKickoffPlan } from "./goal-kickoff";
import { PolicyService } from "./policy-service";
import { IdentityAccessService } from "./identity-access-service";
import { OrgGovernanceService } from "./org-governance-service";
import { assertUsableMentionName } from "../../shared/mention-handles";
import { seedOrganization } from "./organization-seed";

export class OrganizationService {
  private readonly audit: AuditService;
  private readonly policy: PolicyService;
  private readonly identityAccess: IdentityAccessService;
  private readonly governance: OrgGovernanceService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
    this.policy = new PolicyService(db);
    this.identityAccess = new IdentityAccessService(db);
    this.governance = new OrgGovernanceService(db);
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
    const hiringPolicy = this.governance.enforceHiringPolicy(input);
    const id = createId("agt");
    const now = new Date().toISOString();
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
      "active",
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
    this.addAgentToWorkspaceSpaces(input.orgId, id);
    this.identityAccess.createAgentServiceIdentity(input.orgId, id, input.name, now);
    if (hiringPolicy.reviewRequired) {
      const approvalId = createId("app");
      const autoApprove = this.autonomy(input.orgId).autoApproveHires;
      const decision = this.approvalDecision(input.orgId, autoApprove, now);
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
        decision.state,
        decision.decidedBy,
        now,
        decision.decidedAt,
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
    const department = this.governance.requireCanonicalDepartment(input.orgId, input.department);
    const budgetCents = Math.max(0, Math.round(input.budgetCents));
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
        project_id, goal_id, workspace_id, priority, requires_filesystem, created_at, updated_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      now,
      now,
    );
    const policy = this.policy.evaluateTaskCreation(input.orgId, input.risk);
    const approvalRequired = policy.approvalRequired || input.requiresFilesystem;
    if (approvalRequired) {
      const approvalId = createId("app");
      const approvalKind = policy.approvalRequired ? "task_risk" : "task_execution";
      const autoApprove = this.autonomy(input.orgId).executionMode === "ai_ceo";
      const decision = this.approvalDecision(input.orgId, autoApprove, now);
      this.db.prepare(`
        insert into approvals(
          id, org_id, kind, title, details, risk, requested_by_type,
          requested_by_id, source_entity_type, source_entity_id, state, decided_by_employee_id, created_at, decided_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        approvalId,
        input.orgId,
        approvalKind,
        input.title.trim(),
        input.description.trim(),
        RISK_LEVEL.HIGH,
        "system",
        null,
        "task",
        id,
        decision.state,
        decision.decidedBy,
        now,
        decision.decidedAt,
      );
      this.settleApproval(input.orgId, approvalId, approvalKind, RISK_LEVEL.HIGH, autoApprove);
    }
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

  /**
   * Reads the org's autonomy settings. In `ai_ceo` mode the CEO runs without
   * the operator approving each task; `autoApproveHires` clears hire reviews.
   */
  private autonomy(orgId: string): { executionMode: string; autoApproveHires: boolean } {
    const row = this.db.prepare("select execution_mode, auto_approve_hires from organizations where id = ?")
      .get(orgId) as { execution_mode: string; auto_approve_hires: number } | undefined;
    if (!row) throw new Error("Organization was not found.");
    return { executionMode: row.execution_mode, autoApproveHires: row.auto_approve_hires === 1 };
  }

  /** The decision recorded on an approval: pending, or auto-approved by the board chair. */
  private approvalDecision(orgId: string, autoApprove: boolean, now: string): { state: ApprovalState; decidedBy: string | null; decidedAt: string | null } {
    if (!autoApprove) return { state: APPROVAL_STATE.PENDING, decidedBy: null, decidedAt: null };
    return { state: APPROVAL_STATE.APPROVED, decidedBy: this.boardChairEmployeeId(orgId), decidedAt: now };
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

  private boardChairEmployeeId(orgId: string): string {
    const row = this.db.prepare("select id from employees where org_id = ? order by created_at asc limit 1")
      .get(orgId) as { id: string } | undefined;
    if (!row) throw new Error("Organization has no employee to record the approval decision.");
    return row.id;
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
      where org_id = ? and lifecycle = 'active' and lower(name) = lower(?) and (? is null or id <> ?)
      limit 1
    `).get(orgId, name.trim(), exceptAgentId, exceptAgentId) as { id: string } | undefined;
    if (clash) throw new Error(`An active agent named "${name.trim()}" already exists. Pick a different name.`);
  }

  private addAgentToWorkspaceSpaces(orgId: string, agentId: string): void {
    const spaces = this.db.prepare("select id from chat_spaces where org_id = ? and visibility = ? and space_type <> ?")
      .all(orgId, "workspace", "direct") as Array<{ id: string }>;
    for (const space of spaces) {
      this.db.prepare(`
        insert into chat_memberships(space_id, principal_type, principal_id, role, mute_state)
        values (?, ?, ?, ?, ?)
        on conflict(space_id, principal_type, principal_id) do nothing
      `).run(space.id, "agent", agentId, "member", "unmuted");
    }
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
    const now = new Date().toISOString();
    if (input.assigneeAgentId) this.verifyOptionalOrgEntity("agents", input.assigneeAgentId, input.orgId, "Assignee agent");
    if (input.parentTaskId) {
      const parent = this.db.prepare("select id from tasks where id = ? and org_id = ?").get(input.parentTaskId, input.orgId);
      if (!parent) throw new Error("Parent task was not found.");
    }
    const result = this.db.prepare(`
      update tasks set title = ?, description = ?, assignee_agent_id = ?, risk = ?, priority = ?, parent_task_id = ?, updated_at = ?
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

  deleteTask(input: DeleteTaskInput): void {
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

  updateTaskStatus(orgId: string, taskId: string, status: string): void {
    const result = this.db.prepare("update tasks set status = ?, updated_at = ? where id = ? and org_id = ?")
      .run(status, new Date().toISOString(), taskId, orgId);
    if (result.changes === 0) throw new Error("Task was not found.");
    this.audit.record({
      orgId,
      entityType: "task",
      entityId: taskId,
      actorType: "system",
      actorId: null,
      action: "status_changed",
      payload: { status },
    });
  }
}

/** Avatar colors persist as #rrggbb; anything else is a caller bug. */
function normalizeAvatarColor(value: string): string | null {
  const color = value.trim();
  if (!color) return null;
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error("Avatar color must be a #rrggbb hex value.");
  return color.toLowerCase();
}

/**
 * Avatar portraits persist as small base64 data URLs (the renderer downscales
 * before submitting). The cap keeps a rogue caller from turning the snapshot
 * back into a megabyte payload.
 */
const MAX_AVATAR_IMAGE_CHARS = 300_000;

function normalizeAvatarImage(value: string): string | null {
  const image = value.trim();
  if (!image) return null;
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) {
    throw new Error("Avatar image must be a base64 data URL (png, jpeg, or webp).");
  }
  if (image.length > MAX_AVATAR_IMAGE_CHARS) {
    throw new Error("Avatar image is too large - upload a smaller picture.");
  }
  return image;
}
