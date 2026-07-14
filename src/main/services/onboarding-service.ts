import type { DatabaseSync } from "node:sqlite";
import type {
  BootstrapOnboardingInput,
  BootstrapOnboardingSummary,
  SaveProviderCredentialInput,
} from "../../shared/commands";
import { PROVIDER_AUTH_TYPE, RISK_LEVEL, TASK_STATUS } from "../../shared/domain";
import { PROVIDER_CATALOG } from "../../shared/provider-catalog";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";
import { ensureCeoDirectSpace } from "./ceo-direct-space";
import { goalKickoffDescription, goalKickoffTitle } from "./goal-kickoff";
import { OrganizationService } from "./organization-service";
import { ChatService } from "./chat-service";

interface OnboardingServiceDeps {
  db: DatabaseSync;
  saveProviderCredential(input: SaveProviderCredentialInput): void;
}

export class OnboardingService {
  private readonly audit: AuditService;
  private readonly organization: OrganizationService;
  private readonly chat: ChatService;

  constructor(private readonly deps: OnboardingServiceDeps) {
    this.audit = new AuditService(deps.db);
    this.organization = new OrganizationService(deps.db);
    this.chat = new ChatService(deps.db);
  }

  bootstrap(input: BootstrapOnboardingInput): BootstrapOnboardingSummary {
    const provider = this.resolveProvider(input.providerKey);
    const orgId = this.organization.createOrganization({
      organizationName: input.companyName,
      description: input.companyDescription,
      mission: input.companyDescription,
      goal: input.goalTitle,
      employeeName: input.employeeName,
      executionMode: input.executionMode,
      autoApproveHires: input.autoApproveHires,
      reviewDeliverables: input.reviewDeliverables,
    });
    const employeeId = this.requirePrimaryEmployee(orgId);
    const providerId = this.requireProvider(orgId, provider.key);
    this.deps.saveProviderCredential({
      orgId,
      providerId,
      secret: input.providerSecret,
      model: input.providerModel,
    });

    const now = new Date().toISOString();
    const workspaceId = this.createWorkspace(orgId, input.workspacePath.trim(), now);
    const ceoAgentId = this.organization.createAgent({
      orgId,
      name: "CEO",
      role: "CEO",
      title: "Chief Executive Officer",
      department: "Executive",
      modelProviderId: providerId,
      modelId: input.providerModel.trim(),
      budgetCents: 25000,
      managerAgentId: null,
      roleLevel: "c_suite",
      modelStrategy: "explicit",
      workspaceId,
      heartbeatEnabled: true,
      heartbeatIntervalSec: 120,
    });
    const goalId = this.createGoal(orgId, ceoAgentId, input, now);
    const projectId = this.createProject(orgId, goalId, ceoAgentId, input, now);
    this.createProjectChatSpace(orgId, projectName(input));
    // The founder⇄CEO conversation is a bootstrap deliverable, not an option:
    // the Messages page pins it, so its absence here is a hard failure.
    if (!ensureCeoDirectSpace(this.deps.db, orgId)) {
      throw new Error("The founder⇄CEO conversation was not created during bootstrap.");
    }
    if (workspaceId) this.bindWorkspaceToProject(workspaceId, projectId, now);
    const taskId = this.organization.createTask({
      orgId,
      title: goalKickoffTitle(input.goalTitle),
      description: goalKickoffDescription(input.companyName, input.goalTitle, input.goalDescription),
      status: TASK_STATUS.BACKLOG,
      assigneeAgentId: ceoAgentId,
      risk: RISK_LEVEL.MEDIUM,
      projectId,
      goalId,
      workspaceId,
      priority: "high",
      requiresFilesystem: workspaceId !== null,
    });
    const runId = this.createTaskRun(orgId, taskId, ceoAgentId, providerId, workspaceId, now);


    this.audit.record({
      orgId,
      entityType: "organization",
      entityId: orgId,
      actorType: "employee",
      actorId: employeeId,
      action: "bootstrapped",
      payload: { providerKey: provider.key, goalId, projectId, taskId, runId },
    });

    return { orgId, employeeId, ceoAgentId, workspaceId, goalId, projectId, taskId, runId, providerId };
  }

  private resolveProvider(providerKey: string) {
    const provider = PROVIDER_CATALOG.find((entry) => entry.key === providerKey);
    if (!provider) throw new Error(`Provider ${providerKey} is unavailable.`);
    if (provider.authType === PROVIDER_AUTH_TYPE.CLOUD && !provider.customEndpoint) {
      throw new Error("Cloud providers need extended configuration — connect them from Settings after the company is created.");
    }
    return provider;
  }

  private requirePrimaryEmployee(orgId: string): string {
    const row = this.deps.db.prepare("select id from employees where org_id = ? order by created_at asc limit 1")
      .get(orgId) as { id: string } | undefined;
    if (!row) throw new Error("Primary employee was not created.");
    return row.id;
  }

  private requireProvider(orgId: string, providerKey: string): string {
    const row = this.deps.db.prepare("select id from providers where org_id = ? and provider_key = ?")
      .get(orgId, providerKey) as { id: string } | undefined;
    if (!row) throw new Error(`Provider ${providerKey} was not created.`);
    return row.id;
  }

  private createWorkspace(orgId: string, workspacePath: string, now: string): string | null {
    if (!workspacePath) return null;
    const workspaceId = createId("wsp");
    this.deps.db.prepare(`
      insert into workspaces(
        id, org_id, name, local_path, repo_url, repo_ref, project_id, is_primary, created_at, updated_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(workspaceId, orgId, "Default Workspace", workspacePath, "", "", null, 1, now, now);
    return workspaceId;
  }

  private createGoal(orgId: string, ceoAgentId: string, input: BootstrapOnboardingInput, now: string): string {
    const goalTitle = input.goalTitle.trim();
    if (!goalTitle) throw new Error("Goal title is required.");
    const goalId = createId("gol");
    this.deps.db.prepare(`
      insert into goals(id, org_id, title, description, status, owner_agent_id, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(goalId, orgId, goalTitle, input.goalDescription.trim(), "active", ceoAgentId, now, now);
    return goalId;
  }

  private createProject(
    orgId: string,
    goalId: string,
    ceoAgentId: string,
    input: BootstrapOnboardingInput,
    now: string,
  ): string {
    const projectId = createId("prj");
    this.deps.db.prepare(`
      insert into projects(id, org_id, goal_id, name, description, lead_agent_id, status, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      projectId,
      orgId,
      goalId,
      projectName(input),
      input.companyDescription.trim(),
      ceoAgentId,
      "in_progress",
      now,
      now,
    );
    return projectId;
  }

  private createProjectChatSpace(orgId: string, name: string): string {
    return this.chat.createSpace({
      orgId,
      spaceType: "project",
      name: projectSpaceName(name),
      topic: name,
      visibility: "workspace",
    });
  }

  private bindWorkspaceToProject(workspaceId: string, projectId: string, now: string): void {
    this.deps.db.prepare("update workspaces set project_id = ?, updated_at = ? where id = ?")
      .run(projectId, now, workspaceId);
  }

  private createTaskRun(orgId: string, taskId: string, ceoAgentId: string, providerId: string, workspaceId: string | null, now: string): string {
    const runId = createId("run");
    const executionContextId = createId("ctx");
    const serviceIdentityId = this.requireServiceIdentity(orgId, ceoAgentId);
    const workspaceMountJson = JSON.stringify(workspaceId ? [{
      workspaceId,
      mode: "read_write",
    }] : []);
    const secretScopeJson = JSON.stringify({
      serviceIdentityId,
      providerIds: [providerId],
      scope: "bootstrap",
      credentialAccess: "provider_runtime_only",
    });
    this.deps.db.prepare(`
      insert into task_runs(
        id, org_id, task_id, agent_id, provider_id, provider_request_id,
        execution_context_id, service_identity_id, workspace_mount_json, secret_scope_json,
        trigger, state, created_at, started_at, completed_at, error_message
      )
      values (?, ?, ?, ?, ?, null, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      orgId,
      taskId,
      ceoAgentId,
      providerId,
      executionContextId,
      serviceIdentityId,
      workspaceMountJson,
      secretScopeJson,
      "bootstrap",
      "queued",
      now,
      null,
      null,
      null,
    );
    return runId;
  }

  private requireServiceIdentity(orgId: string, agentId: string): string {
    const row = this.deps.db.prepare("select id from service_identities where org_id = ? and agent_id = ?")
      .get(orgId, agentId) as { id: string } | undefined;
    if (!row) throw new Error("Agent service identity was not found.");
    return row.id;
  }

}

function projectName(input: BootstrapOnboardingInput): string {
  return `Execution plan: ${input.goalTitle.trim()}`;
}

function projectSpaceName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/g, "");
  return slug || "project";
}
