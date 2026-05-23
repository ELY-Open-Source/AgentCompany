import type { DatabaseSync } from "node:sqlite";
import { APPROVAL_STATE, RISK_LEVEL, TASK_STATUS } from "../../shared/domain";
import { PROVIDER_CATALOG } from "../../shared/provider-catalog";
import { createId } from "../../shared/ids";
import type { CreateAgentInput, CreateOrganizationInput, CreateTaskInput } from "../../shared/commands";
import { AuditService } from "./audit-service";
import { PolicyService } from "./policy-service";
import { IdentityAccessService } from "./identity-access-service";
import { OrgGovernanceService } from "./org-governance-service";
import { assertUsableMentionName } from "./mention-handles";

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
      this.db.prepare(`
        insert into approvals(
          id, org_id, kind, title, details, risk, requested_by_type,
          requested_by_id, state, decided_by_employee_id, created_at, decided_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        approvalId,
        input.orgId,
        "agent_hire",
        `Review hire: ${input.name.trim()}`,
        `Department: ${input.department.trim()}\nRole: ${input.role.trim()}\nBudget: ${input.budgetCents}`,
        RISK_LEVEL.MEDIUM,
        "system",
        null,
        APPROVAL_STATE.PENDING,
        null,
        now,
        null,
      );
      this.governance.routeApproval({ orgId: input.orgId, approvalId, kind: "agent_hire", risk: RISK_LEVEL.MEDIUM });
    }
    return id;
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
    if (policy.approvalRequired) {
      const approvalId = createId("app");
      this.db.prepare(`
        insert into approvals(
          id, org_id, kind, title, details, risk, requested_by_type,
          requested_by_id, state, decided_by_employee_id, created_at, decided_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        approvalId,
        input.orgId,
        "task_risk",
        input.title.trim(),
        input.description.trim(),
        RISK_LEVEL.HIGH,
        "system",
        null,
        APPROVAL_STATE.PENDING,
        null,
        now,
        null,
      );
      this.governance.routeApproval({ orgId: input.orgId, approvalId, kind: "task_risk", risk: RISK_LEVEL.HIGH });
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
