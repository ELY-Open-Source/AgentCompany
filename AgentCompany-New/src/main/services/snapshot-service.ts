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
    const activeOrgId = organizations[0]?.id ?? null;
    const agents = list<AppSnapshot["agents"][number]>(this.db, "agents", "created_at asc")
      .map((agent) => ({ ...agent, heartbeatEnabled: toBool(agent.heartbeatEnabled) }));
    const tasks = list<AppSnapshot["tasks"][number]>(this.db, "tasks", "created_at asc")
      .map((task) => ({ ...task, requiresFilesystem: toBool(task.requiresFilesystem) }));
    const workspaces = list<AppSnapshot["workspaces"][number]>(this.db, "workspaces", "created_at asc")
      .map((workspace) => ({ ...workspace, isPrimary: toBool(workspace.isPrimary) }));
    const providers = list<AppSnapshot["providers"][number]>(this.db, "providers", "label asc")
      .map((provider) => ({ ...provider, enabled: toBool(provider.enabled) }));
    const skillBindings = list<AppSnapshot["skillBindings"][number]>(this.db, "skill_bindings", "priority asc")
      .map((binding) => ({ ...binding, enabled: toBool(binding.enabled) }));

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
      chatPresence: list(this.db, "chat_presence", "last_seen_at desc"),
      files: list(this.db, "file_objects", "created_at desc"),
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
      auditEvents: list<AppSnapshot["auditEvents"][number]>(this.db, "audit_events", "created_at desc").slice(0, 200),
    };
  }
}
