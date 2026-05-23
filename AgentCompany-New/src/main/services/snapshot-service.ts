import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { AppSnapshot } from "../../shared/domain";
import { PROVIDER_CATALOG } from "../../shared/provider-catalog";

type Row = Record<string, unknown>;

function all<T>(statement: StatementSync): T[] {
  return statement.all() as T[];
}

function toBool(value: unknown): boolean {
  return value === 1 || value === true;
}

function camel(row: Row): Row {
  const next: Row = {};
  for (const [key, value] of Object.entries(row)) {
    next[key.replace(/_([a-z])/g, (_m, ch: string) => ch.toUpperCase())] = value;
  }
  return next;
}

function list<T>(db: DatabaseSync, table: string, orderBy: string): T[] {
  return all<Row>(db.prepare(`select * from ${table} order by ${orderBy}`)).map((row) => camel(row) as T);
}

export class SnapshotService {
  constructor(private readonly db: DatabaseSync) {}

  load(): AppSnapshot {
    const organizations = list<AppSnapshot["organizations"][number]>(this.db, "organizations", "created_at asc")
      .map((org) => ({
        ...org,
        autoApproveHires: toBool(org.autoApproveHires),
        reviewDeliverables: toBool(org.reviewDeliverables),
      }));
    const activeOrgId = this.resolveActiveOrgId(organizations.map((org) => org.id));
    const agents = list<AppSnapshot["agents"][number]>(this.db, "agents", "created_at asc")
      .map((agent) => ({ ...agent, heartbeatEnabled: toBool(agent.heartbeatEnabled) }));
    const tasks = list<AppSnapshot["tasks"][number]>(this.db, "tasks", "created_at asc")
      .map((task) => ({ ...task, requiresFilesystem: toBool(task.requiresFilesystem) }));
    const workspaces = list<AppSnapshot["workspaces"][number]>(this.db, "workspaces", "created_at asc")
      .map((workspace) => ({ ...workspace, isPrimary: toBool(workspace.isPrimary) }));
    const providers = list<AppSnapshot["providers"][number]>(this.db, "providers", "label asc")
      .map((provider) => ({ ...provider, enabled: toBool(provider.enabled), backgroundEnabled: toBool(provider.backgroundEnabled) }));
    const skillBindings = list<AppSnapshot["skillBindings"][number]>(this.db, "skill_bindings", "priority asc")
      .map((binding) => ({ ...binding, enabled: toBool(binding.enabled) }));
    const files = list<AppSnapshot["files"][number]>(this.db, "file_objects", "created_at desc")
      .map((file) => ({ ...file, pinned: toBool(file.pinned) }));
    const legalHolds = list<AppSnapshot["legalHolds"][number]>(this.db, "legal_holds", "created_at desc")
      .map((hold) => ({ ...hold, active: toBool(hold.active) }));
    const retentionFreezes = list<AppSnapshot["retentionFreezes"][number]>(this.db, "retention_freezes", "created_at desc")
      .map((freeze) => ({ ...freeze, active: toBool(freeze.active) }));
    const employeeIdentities = list<AppSnapshot["employeeIdentities"][number]>(this.db, "employee_identities", "created_at desc")
      .map((identity) => ({ ...identity, active: toBool(identity.active) }));

    return {
      activeOrgId,
      organizations,
      employees: list(this.db, "employees", "created_at asc"),
      agents,
      tasks,
      workspaces,
      goals: list(this.db, "goals", "created_at asc"),
      projects: list(this.db, "projects", "created_at asc"),
      taskRuns: list(this.db, "task_runs", "created_at asc"),
      approvals: list(this.db, "approvals", "created_at desc"),
      chatSpaces: list(this.db, "chat_spaces", "created_at asc"),
      chatMessages: list(this.db, "chat_messages", "created_at asc"),
      chatThreads: list(this.db, "chat_threads", "updated_at desc"),
      chatAttachments: list(this.db, "chat_attachments", "message_id asc"),
      chatMentions: list(this.db, "chat_mentions", "message_id asc, offset_start asc"),
      chatSlashInvocations: list(this.db, "chat_slash_invocations", "created_at asc"),
      boardInterventions: list(this.db, "board_interventions", "created_at asc"),
      chatPresence: list(this.db, "chat_presence", "last_seen_at desc"),
      chatReadStates: list(this.db, "chat_read_state", "last_read_at desc"),
      files,
      fileAccessGrants: list(this.db, "file_access_grants", "created_at desc"),
      scheduledPosts: list(this.db, "scheduled_posts", "scheduled_for asc"),
      providers,
      providerCatalog: PROVIDER_CATALOG,
      providerRequests: list(this.db, "provider_requests", "created_at desc"),
      skillDefinitions: list(this.db, "skill_definitions", "created_at asc"),
      skillRevisions: list(this.db, "skill_revisions", "published_at desc"),
      skillBindings,
      skillRuntimeSnapshots: list(this.db, "skill_runtime_snapshots", "created_at desc"),
      socialAccounts: list(this.db, "social_accounts", "created_at asc"),
      socialAccountGrants: list(this.db, "social_account_grants", "created_at asc"),
      browserActions: list(this.db, "browser_actions", "created_at desc"),
      policyRules: list(this.db, "policy_rules", "created_at asc"),
      migrationReports: list(this.db, "migration_reports", "created_at desc"),
      complianceExports: list(this.db, "compliance_exports", "created_at desc"),
      legalHolds,
      retentionFreezes,
      employeeIdentities,
      serviceIdentities: list(this.db, "service_identities", "created_at desc"),
      roleGrants: list(this.db, "role_grants", "created_at desc"),
      accessDecisions: list<AppSnapshot["accessDecisions"][number]>(this.db, "access_decisions", "created_at desc").slice(0, 200),
      orgDepartments: list(this.db, "org_departments", "name asc"),
      hiringPolicies: list(this.db, "hiring_policies", "department_name asc"),
      approvalRoutingRules: list(this.db, "approval_routing_rules", "created_at asc"),
      approvalAssignments: list(this.db, "approval_assignments", "created_at desc"),
      auditEvents: list<AppSnapshot["auditEvents"][number]>(this.db, "audit_events", "created_at desc").slice(0, 200),
    };
  }

  private resolveActiveOrgId(known: string[]): string | null {
    const row = this.db.prepare("select active_org_id from app_state where id = 1")
      .get() as { active_org_id: string | null } | undefined;
    const stored = row?.active_org_id ?? null;
    if (stored && known.includes(stored)) return stored;
    return known[0] ?? null;
  }
}
