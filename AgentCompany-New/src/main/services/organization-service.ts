import type { DatabaseSync } from "node:sqlite";
import { APPROVAL_STATE, RISK_LEVEL, TASK_STATUS, type ApprovalState } from "../../shared/domain";
import { PROVIDER_CATALOG } from "../../shared/provider-catalog";
import { createId } from "../../shared/ids";
import type { CreateAgentInput, CreateGoalInput, CreateOrganizationInput, CreateProjectInput, CreateTaskInput, CreateWorkspaceInput, UpdateAgentInput } from "../../shared/commands";
import { AuditService } from "./audit-service";
import { PolicyService } from "./policy-service";
import { IdentityAccessService } from "./identity-access-service";
import { OrgGovernanceService } from "./org-governance-service";
import { OperationsService } from "./operations-service";
import { SdlcService } from "./sdlc-service";
import { assertUsableMentionName } from "./mention-handles";

export class OrganizationService {
  private readonly audit: AuditService;
  private readonly policy: PolicyService;
  private readonly identityAccess: IdentityAccessService;
  private readonly governance: OrgGovernanceService;
  private readonly operations: OperationsService;
  private readonly sdlc: SdlcService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
    this.policy = new PolicyService(db);
    this.identityAccess = new IdentityAccessService(db);
    this.governance = new OrgGovernanceService(db);
    this.operations = new OperationsService(db);
    this.sdlc = new SdlcService(db);
  }

  createOrganization(input: CreateOrganizationInput): string {
    assertUsableMentionName(input.employeeName);
    const orgId = createId("org");
    const employeeId = createId("emp");
    const now = new Date().toISOString();

    this.db.prepare(`
      insert into organizations(
        id, name, mission, goal, description, execution_mode, auto_approve_hires, review_deliverables, created_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      orgId,
      input.organizationName.trim(),
      input.mission.trim(),
      input.goal.trim(),
      input.description?.trim() ?? "",
      input.executionMode ?? "ai_ceo",
      input.autoApproveHires === false ? 0 : 1,
      input.reviewDeliverables === true ? 1 : 0,
      now,
    );
    this.db.prepare("insert into employees(id, org_id, display_name, role, created_at) values (?, ?, ?, ?, ?)")
      .run(employeeId, orgId, input.employeeName.trim(), "Board Chair", now);
    this.identityAccess.seedEmployeeAccess(orgId, employeeId, now);
    this.governance.seedOrganizationGovernance(orgId, employeeId, now);
    this.operations.seedOrganizationOperations(orgId, now);
    this.sdlc.seedOrganizationSdlc(orgId, now);

    for (const space of [
      ["company", "general", "Company coordination", "workspace"],
      ["department", "product", "Product decisions", "workspace"],
      ["department", "engineering", "Engineering delivery", "workspace"],
      ["company", "board", "Board decisions", "restricted"],
    ]) {
      const spaceId = createId("spc");
      this.db.prepare(`
        insert into chat_spaces(id, org_id, space_type, name, topic, visibility, created_at)
        values (?, ?, ?, ?, ?, ?, ?)
      `).run(spaceId, orgId, space[0], space[1], space[2], space[3], now);
      this.db.prepare(`
        insert into chat_memberships(space_id, principal_type, principal_id, role, mute_state)
        values (?, ?, ?, ?, ?)
      `).run(spaceId, "employee", employeeId, space[1] === "board" ? "approver" : "member", "unmuted");
    }

    for (const provider of PROVIDER_CATALOG) {
      this.db.prepare(`
        insert into providers(id, org_id, provider_key, label, auth_type, model, credential_id, enabled, created_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        createId("prv"),
        orgId,
        provider.key,
        provider.label,
        provider.authType,
        provider.defaultModel,
        null,
        0,
        now,
      );
    }

    this.policy.seedOrganizationPolicies(orgId, now);
    this.db.prepare(`
      insert into app_state(id, active_org_id, updated_at)
      values (1, ?, ?)
      on conflict(id) do update set active_org_id = excluded.active_org_id, updated_at = excluded.updated_at
    `).run(orgId, now);
    this.audit.record({
      orgId,
      entityType: "organization",
      entityId: orgId,
      actorType: "employee",
      actorId: employeeId,
      action: "created",
      payload: { name: input.organizationName.trim() },
    });
    return orgId;
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
      input.department.trim(),
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
      payload: { role: input.role, department: input.department },
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
        `Department: ${input.department.trim()}\nRole: ${input.role.trim()}\nBudget: ${input.budgetCents}`,
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
    return id;
  }

  updateAgent(input: UpdateAgentInput): void {
    const agent = this.db.prepare("select id from agents where id = ? and org_id = ?")
      .get(input.agentId, input.orgId) as { id: string } | undefined;
    if (!agent) throw new Error("Agent was not found.");
    const role = input.role.trim();
    if (!role) throw new Error("Agent role is required.");
    if (input.modelProviderId) {
      const provider = this.db.prepare("select id from providers where id = ? and org_id = ?")
        .get(input.modelProviderId, input.orgId) as { id: string } | undefined;
      if (!provider) throw new Error("Agent provider was not found.");
    }
    const result = this.db.prepare(`
      update agents
      set role = ?, title = ?, role_level = ?, model_provider_id = ?, model_id = ?
      where id = ? and org_id = ?
    `).run(role, input.title.trim() || role, input.roleLevel.trim() || "staff", input.modelProviderId, input.modelId, input.agentId, input.orgId);
    if (result.changes === 0) throw new Error("Agent update failed.");
    this.audit.record({
      orgId: input.orgId,
      entityType: "agent",
      entityId: input.agentId,
      actorType: "employee",
      actorId: null,
      action: "updated",
      payload: { role, roleLevel: input.roleLevel.trim() || "staff" },
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
    return id;
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
