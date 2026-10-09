import { loadViewState } from "./view-state";
import { loadOnboardingDraft } from "./onboarding-progress";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { AppSnapshot } from "../../shared/domain";
import { PROVIDER_CATALOG } from "../../shared/provider-catalog";
import { IntegrationKeyStore } from "./integration-key-store";
import { currentProviderUsageWindow } from "../../shared/provider-runtime-domain";
import { buildUsageStats } from "./usage-stats";
import { taskHolds } from "./task-holds";
import { chatReplyStatuses } from "./chat-reply-status";
import { channelAnchorAgentId } from "./chat-anchor";

type Row = Record<string, unknown>;
type ProviderUsageWindowRow = Pick<
  AppSnapshot["providerRateLimits"][number],
  "orgId" | "providerId" | "windowStart" | "windowEnd" | "requestCount" | "inputCharCount" | "outputCharCount"
  | "costCents" | "inputTokens" | "outputTokens" | "requestsWithoutUsage" | "unpricedRequests"
>;

function all<T>(statement: StatementSync): T[] {
  return statement.all() as T[];
}

function toBool(value: unknown): boolean {
  return value === 1 || value === true;
}

export function camel(row: Row): Row {
  const next: Row = {};
  for (const [key, value] of Object.entries(row)) {
    next[key.replace(/_([a-z])/g, (_m, ch: string) => ch.toUpperCase())] = value;
  }
  return next;
}

function list<T>(db: DatabaseSync, table: string, orderBy: string): T[] {
  return all<Row>(db.prepare(`select * from ${table} order by ${orderBy}`)).map((row) => camel(row) as T);
}

function recentList<T>(db: DatabaseSync, table: string, orderBy: string, limit: number): T[] {
  return all<Row>(db.prepare(`select * from ${table} order by ${orderBy} limit ${limit}`)).map((row) => camel(row) as T);
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
    const holds = taskHolds(this.db, new Date());
    const chatMessages = recentList<AppSnapshot["chatMessages"][number]>(this.db, "chat_messages", "created_at desc, rowid desc", 500).reverse();
    const tasks = list<AppSnapshot["tasks"][number]>(this.db, "tasks", "created_at asc")
      .map((task) => ({ ...task, requiresFilesystem: toBool(task.requiresFilesystem), hold: holds.get(task.id) ?? null }));
    const workspaces = list<AppSnapshot["workspaces"][number]>(this.db, "workspaces", "created_at asc")
      .map((workspace) => ({ ...workspace, isPrimary: toBool(workspace.isPrimary) }));
    const providers = list<AppSnapshot["providers"][number]>(this.db, "providers", "label asc")
      .map((provider) => ({ ...provider, enabled: toBool(provider.enabled), backgroundEnabled: toBool(provider.backgroundEnabled) }));
    const providerAuthProfiles = list<AppSnapshot["providerAuthProfiles"][number]>(this.db, "provider_auth_profiles", "created_at desc")
      .map((profile) => ({ ...profile, active: toBool(profile.active) }));
    const providerAuthSessions = list<AppSnapshot["providerAuthSessions"][number]>(this.db, "provider_auth_sessions", "created_at desc");
    const providerRateLimitObservations = list<AppSnapshot["providerRateLimitObservations"][number]>(
      this.db,
      "provider_rate_limit_observations",
      "observed_at desc",
    );
    const providerUsageWindows = list<ProviderUsageWindowRow>(this.db, "provider_usage_windows", "window_start desc");
    const providerRateLimits = buildProviderRateLimits(providers, providerUsageWindows);
    const files = list<AppSnapshot["files"][number]>(this.db, "file_objects", "created_at desc")
      .map((file) => ({ ...file, pinned: toBool(file.pinned) }));
    const legalHolds = list<AppSnapshot["legalHolds"][number]>(this.db, "legal_holds", "created_at desc")
      .map((hold) => ({ ...hold, active: toBool(hold.active) }));
    const retentionFreezes = list<AppSnapshot["retentionFreezes"][number]>(this.db, "retention_freezes", "created_at desc")
      .map((freeze) => ({ ...freeze, active: toBool(freeze.active) }));
    const employeeIdentities = list<AppSnapshot["employeeIdentities"][number]>(this.db, "employee_identities", "created_at desc")
      .map((identity) => ({ ...identity, active: toBool(identity.active) }));
    const featureFlags = list<AppSnapshot["featureFlags"][number]>(this.db, "feature_flags", "key asc")
      .map((flag) => ({ ...flag, enabled: toBool(flag.enabled) }));
    const operationalEvents = list<AppSnapshot["operationalEvents"][number]>(this.db, "operational_events", "created_at desc")
      .map((event) => ({ ...event, success: toBool(event.success) }));

    return {
      activeOrgId,
      uiPreferences: this.resolveUiPreferences(),
      onboardingDraft: loadOnboardingDraft(this.db),
      viewState: loadViewState(this.db),
      autonomousPaused: this.resolveAutonomousPaused(),
      integrationKeys: new IntegrationKeyStore(this.db).statuses(),
      organizations,
      employees: list(this.db, "employees", "created_at asc"),
      agents,
      tasks,
      workspaces,
      goals: list(this.db, "goals", "created_at asc"),
      projects: list(this.db, "projects", "created_at asc"),
      taskRuns: recentList<AppSnapshot["taskRuns"][number]>(this.db, "task_runs", "created_at desc, rowid desc", 200).reverse(),
      approvals: list(this.db, "approvals", "created_at desc"),
      chatSpaces: list(this.db, "chat_spaces", "created_at asc"),
      chatMemberships: list(this.db, "chat_memberships", "space_id asc, principal_type asc, principal_id asc"),
      chatMessages,
      chatReplyStatuses: chatReplyStatuses(this.db, chatMessages.map((message) => message.id), holds),
      chatSpaceAnchors: (this.db.prepare("select id, org_id from chat_spaces where space_type <> 'direct'").all() as Array<{ id: string; org_id: string }>)
        .flatMap((space) => {
          const agentId = channelAnchorAgentId(this.db, space.org_id, space.id);
          return agentId ? [{ spaceId: space.id, agentId }] : [];
        }),
      // Every thread a loaded message belongs to, plus the most recently active ones, so no shown message loses its thread.
      chatThreads: all<Row>(this.db.prepare(`
        select * from chat_threads
        where id in (select thread_id from (select thread_id from chat_messages order by created_at desc, rowid desc limit 500))
          or id in (select id from chat_threads order by updated_at desc limit 200)
        order by updated_at desc
      `)).map((row) => camel(row) as unknown as AppSnapshot["chatThreads"][number]),
      chatAttachments: recentList(this.db, "chat_attachments", "message_id desc", 500),
      chatMentions: recentList(this.db, "chat_mentions", "message_id desc, offset_start asc", 500),
      chatSlashInvocations: recentList(this.db, "chat_slash_invocations", "created_at desc", 200),
      boardInterventions: list(this.db, "board_interventions", "created_at asc"),
      chatPresence: list(this.db, "chat_presence", "last_seen_at desc"),
      chatReadStates: list(this.db, "chat_read_state", "last_read_at desc"),
      files,
      fileAccessGrants: list(this.db, "file_access_grants", "created_at desc"),
      fileHandoffRecords: list(this.db, "file_handoff_records", "created_at desc"),
      scheduledPosts: list(this.db, "scheduled_posts", "scheduled_for asc"),
      providers,
      providerAuthProfiles,
      providerAuthSessions,
      providerCatalog: PROVIDER_CATALOG,
      // Explicit projection: raw_response_json alone weighs megabytes across
      // 100 rows and no renderer surface reads it.
      providerRequests: all<Row>(this.db.prepare(`
        select id, org_id, provider_id, provider_key, workspace_id, model, prompt_sha256,
               response_text, state, error_message, input_char_count, output_char_count,
               execution_mode, policy_decision, external_response_id, stream_event_count,
               cancelled_at, created_at, completed_at, agent_id, task_run_id,
               input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, cost_cents
        from provider_requests order by created_at desc limit 100
      `)).map((row) => camel(row) as unknown as AppSnapshot["providerRequests"][number]),
      providerRateLimits,
      usageStats: buildUsageStats(this.db, new Date()),
      providerRateLimitObservations,
      skillDefinitions: list(this.db, "skill_definitions", "created_at asc"),
      socialAccounts: list(this.db, "social_accounts", "created_at asc"),
      socialAccountGrants: list(this.db, "social_account_grants", "created_at asc"),
      browserSessionContainers: list<AppSnapshot["browserSessionContainers"][number]>(this.db, "browser_session_containers", "created_at asc")
        .map((container) => ({ ...container, sandboxEnabled: toBool(container.sandboxEnabled) })),
      browserActionPolicies: list<AppSnapshot["browserActionPolicies"][number]>(this.db, "browser_action_policies", "created_at asc")
        .map((policy) => ({ ...policy, approvalRequired: toBool(policy.approvalRequired) })),
      socialApprovalRoutes: list(this.db, "social_approval_routes", "created_at asc"),
      browserActions: list(this.db, "browser_actions", "created_at desc"),
      socialAuditRecords: list(this.db, "social_audit_records", "created_at desc"),
      policyRules: list(this.db, "policy_rules", "created_at asc"),
      migrationReports: list(this.db, "migration_reports", "created_at desc"),
      complianceExports: list(this.db, "compliance_exports", "created_at desc"),
      legalHolds,
      retentionFreezes,
      employeeIdentities,
      serviceIdentities: list(this.db, "service_identities", "created_at desc"),
      roleGrants: list(this.db, "role_grants", "created_at desc"),
      accessDecisions: recentList<AppSnapshot["accessDecisions"][number]>(this.db, "access_decisions", "created_at desc", 200),
      orgDepartments: list(this.db, "org_departments", "name asc"),
      hiringPolicies: list(this.db, "hiring_policies", "department_name asc"),
      approvalRoutingRules: list(this.db, "approval_routing_rules", "created_at asc"),
      approvalAssignments: list(this.db, "approval_assignments", "created_at desc"),
      featureFlags,
      sloTargets: list(this.db, "slo_targets", "signal_key asc"),
      operationalEvents,
      auditEvents: recentList<AppSnapshot["auditEvents"][number]>(this.db, "audit_events", "created_at desc", 200),
      documents: list(this.db, "documents", "updated_at desc"),
      knowledgeEntries: list(this.db, "knowledge_entries", "updated_at desc"),
      automationRules: list<AppSnapshot["automationRules"][number]>(this.db, "automation_rules", "priority asc")
        .map((rule) => ({ ...rule, enabled: toBool(rule.enabled) })),
      meetings: list(this.db, "meetings", "scheduled_at desc"),
      sprints: list(this.db, "sprints", "start_date desc"),
      connectorAccounts: list(this.db, "connector_accounts", "toolkit_slug asc"),
      connectorGrants: list(this.db, "agent_connector_grants", "toolkit_slug asc, created_at asc"),
    };
  }

  private resolveActiveOrgId(known: string[]): string | null {
    const row = this.db.prepare("select active_org_id from app_state where id = 1")
      .get() as { active_org_id: string | null } | undefined;
    const stored = row?.active_org_id ?? null;
    if (stored && known.includes(stored)) return stored;
    return known[0] ?? null;
  }

  private resolveAutonomousPaused(): boolean {
    const row = this.db.prepare("select autorun_paused from app_state where id = 1")
      .get() as { autorun_paused: number } | undefined;
    return row?.autorun_paused === 1;
  }

  private resolveUiPreferences(): AppSnapshot["uiPreferences"] {
    const row = this.db.prepare("select theme, language from app_state where id = 1")
      .get() as { theme: string; language: string } | undefined;
    const theme = row?.theme === "light" || row?.theme === "dark" ? row.theme : "system";
    const language = row?.language === "zh" ? "zh" : "en";
    return { theme, language };
  }
}

function buildProviderRateLimits(
  providers: AppSnapshot["providers"],
  providerUsageWindows: ProviderUsageWindowRow[],
): AppSnapshot["providerRateLimits"] {
  const window = currentProviderUsageWindow();
  return providers.map((provider) => {
    const usage = providerUsageWindows.find((item) => item.providerId === provider.id && item.windowStart === window.start);
    const requestCount = usage?.requestCount ?? 0;
    const inputCharCount = usage?.inputCharCount ?? 0;
    const outputCharCount = usage?.outputCharCount ?? 0;
    const remainingRequestCount = Math.max(0, provider.monthlyRequestLimit - requestCount);
    return {
      orgId: provider.orgId,
      providerId: provider.id,
      providerKey: provider.providerKey,
      windowStart: usage?.windowStart ?? window.start,
      windowEnd: usage?.windowEnd ?? window.end,
      monthlyRequestLimit: provider.monthlyRequestLimit,
      requestCount,
      inputCharCount,
      outputCharCount,
      remainingRequestCount,
      exhausted: remainingRequestCount === 0,
      costCents: usage?.costCents ?? 0,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      requestsWithoutUsage: usage?.requestsWithoutUsage ?? 0,
      unpricedRequests: usage?.unpricedRequests ?? 0,
    };
  });
}
