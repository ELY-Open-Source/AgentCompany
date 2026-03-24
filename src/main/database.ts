import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { appendFile, copyFile, cp, rm } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync, backup as backupDatabase, type SQLInputValue } from "node:sqlite";
import { getConnectorDefinition, buildDefaultConnectorRows, listInvalidEnvBindingKeys, parseEnvBindingText } from "./connectors";
import { SecretVault } from "./vault";
import type {
  ActivityRecord,
  AgentMessageRecord,
  AgentMetrics,
  AgentRecord,
  ApprovalRecord,
  BrowserActionRecord,
  CommentRecord,
  CompanyMetrics,
  CompanyRecord,
  ConnectorId,
  ConnectorRecord,
  CostRecord,
  GoalRecord,
  InboxItem,
  ProfileSnapshot,
  ProjectRecord,
  RunLogChunk,
  RunRecord,
  RunStatus,
  SecretRecord,
  SocialAccountRecord,
  StandupReport,
  TaskRecord,
  WorkflowPipelineRecord,
  WorkspaceRecord,
} from "@shared/types";

type SqliteDatabase = DatabaseSync;
type SqliteRow = Record<string, any>;
const BOARD_READER_ID = "__board__";

function nowIso() {
  return new Date().toISOString();
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function ensureId(id: string | null | undefined) {
  return id && id.length > 0 ? id : randomUUID();
}

function normalizeOptionalId(id: string | null | undefined) {
  return id && id.length > 0 ? id : null;
}

function toBoolean(value: unknown) {
  return value === true || value === 1 || value === "1";
}

function isWithinOrEqual(targetPath: string, rootPath: string) {
  const resolvedTarget = resolve(targetPath);
  const resolvedRoot = resolve(rootPath);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${sep}`);
}

function safeRealpath(targetPath: string) {
  try {
    return realpathSync(targetPath);
  } catch {
    return resolve(targetPath);
  }
}

/**
 * Find the last complete UTF-8 character boundary in a buffer.
 * Returns the number of bytes up to (and including) the last complete character.
 * This prevents corrupting multi-byte CJK characters when slicing at chunk edges.
 */
function findUtf8Boundary(buffer: Buffer, bytesRead: number): number {
  if (bytesRead === 0) return 0;
  // Walk backwards past continuation bytes (10xxxxxx)
  let pos = bytesRead - 1;
  while (pos >= 0 && (buffer[pos] & 0xc0) === 0x80) {
    pos--;
  }
  if (pos < 0) return bytesRead;
  const lead = buffer[pos];
  let charLen: number;
  if ((lead & 0x80) === 0) charLen = 1;
  else if ((lead & 0xe0) === 0xc0) charLen = 2;
  else if ((lead & 0xf0) === 0xe0) charLen = 3;
  else if ((lead & 0xf8) === 0xf0) charLen = 4;
  else return bytesRead;
  // If the character is complete within the buffer, keep all bytes
  if (pos + charLen <= bytesRead) return bytesRead;
  // Otherwise truncate before the incomplete character
  return pos;
}

function taskPriorityOrderSql(columnName: string) {
  return `case ${columnName}
    when 'critical' then 4
    when 'high' then 3
    when 'medium' then 2
    when 'low' then 1
    else 0
  end`;
}

export class AppDatabase {
  readonly profileDir: string;
  readonly dbPath: string;
  readonly logsDir: string;
  readonly artifactsDir: string;
  readonly backupsDir: string;
  readonly vault: SecretVault;
  private db: SqliteDatabase;

  constructor(rootDir: string) {
    this.profileDir = rootDir;
    this.dbPath = join(rootDir, "profile.sqlite");
    this.logsDir = join(rootDir, "logs");
    this.artifactsDir = join(rootDir, "artifacts");
    this.backupsDir = join(rootDir, "backups");
    mkdirSync(rootDir, { recursive: true });
    mkdirSync(this.logsDir, { recursive: true });
    mkdirSync(this.artifactsDir, { recursive: true });
    mkdirSync(this.backupsDir, { recursive: true });
    this.vault = new SecretVault(rootDir);
    this.db = this.openConnection();
  }

  init() {
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(`
      create table if not exists settings (
        key text primary key,
        value text not null
      );
      create table if not exists companies (
        id text primary key,
        name text not null,
        description text not null,
        status text not null,
        created_at text not null,
        updated_at text not null
      );
      create table if not exists connectors (
        id text primary key,
        label text not null,
        description text not null,
        status text not null,
        command text not null,
        version text,
        auth_state text not null,
        last_checked_at text,
        last_error text,
        model text,
        env_binding_text text not null,
        notes text not null,
        updated_at text
      );
      create table if not exists workspaces (
        id text primary key,
        company_id text not null,
        name text not null,
        local_path text not null,
        repo_url text not null,
        repo_ref text not null,
        project_id text,
        state text not null,
        is_primary integer not null default 0,
        created_at text not null,
        updated_at text not null
      );
      create table if not exists agents (
        id text primary key,
        company_id text not null,
        name text not null,
        role text not null,
        title text not null,
        status text not null,
        reports_to text,
        connector_id text not null,
        workspace_id text,
        model text,
        capabilities text not null,
        budget_monthly_usd real not null default 0,
        spent_monthly_usd real not null default 0,
        metadata_json text not null default '{}',
        created_at text not null,
        updated_at text not null
      );
      create table if not exists goals (
        id text primary key,
        company_id text not null,
        title text not null,
        description text not null,
        parent_id text,
        owner_agent_id text,
        status text not null,
        created_at text not null,
        updated_at text not null
      );
      create table if not exists projects (
        id text primary key,
        company_id text not null,
        goal_id text,
        name text not null,
        description text not null,
        lead_agent_id text,
        status text not null,
        target_date text,
        created_at text not null,
        updated_at text not null
      );
      create table if not exists tasks (
        id text primary key,
        company_id text not null,
        project_id text,
        goal_id text,
        parent_id text,
        title text not null,
        description text not null,
        assignee_agent_id text,
        workspace_id text,
        status text not null,
        priority text not null,
        active_run_id text,
        session_json text,
        session_display_id text,
        cost_usd real not null default 0,
        created_at text not null,
        updated_at text not null
      );
      create table if not exists approvals (
        id text primary key,
        company_id text not null,
        related_task_id text,
        requested_by_agent_id text,
        type text not null,
        payload_summary text not null,
        impact_summary text not null,
        payload_json text,
        decision_note text not null default '',
        state text not null,
        created_at text not null,
        updated_at text not null
      );
      create table if not exists runs (
        id text primary key,
        company_id text not null,
        task_id text not null,
        agent_id text not null,
        workspace_id text,
        connector_id text not null,
        status text not null,
        summary text not null,
        error_message text,
        exit_code integer,
        signal text,
        model text,
        session_display_id text,
        cost_usd real,
        unattributed_cost integer not null default 0,
        started_at text,
        finished_at text,
        log_path text,
        created_at text not null,
        updated_at text not null
      );
      create table if not exists cost_entries (
        id text primary key,
        company_id text not null,
        run_id text not null,
        task_id text,
        agent_id text,
        connector_id text not null,
        amount_usd real,
        unattributed integer not null default 0,
        created_at text not null
      );
      create table if not exists activity (
        id text primary key,
        company_id text not null,
        actor text not null,
        action text not null,
        entity_type text not null,
        entity_id text not null,
        detail text not null,
        created_at text not null
      );
      create table if not exists secrets (
        id text primary key,
        company_id text not null,
        name text not null,
        description text not null,
        backend text not null,
        ciphertext blob not null,
        updated_at text not null,
        created_at text not null,
        unique(company_id, name)
      );
    `);

    this.db.exec(`
      create index if not exists idx_workspaces_company on workspaces(company_id);
      create index if not exists idx_agents_company on agents(company_id);
      create index if not exists idx_goals_company on goals(company_id);
      create index if not exists idx_projects_company on projects(company_id);
      create index if not exists idx_tasks_company on tasks(company_id);
      create index if not exists idx_tasks_assignee on tasks(assignee_agent_id);
      create index if not exists idx_tasks_project on tasks(project_id);
      create index if not exists idx_approvals_company on approvals(company_id);
      create index if not exists idx_runs_company on runs(company_id);
      create index if not exists idx_runs_task on runs(task_id);
      create index if not exists idx_runs_agent on runs(agent_id);
      create index if not exists idx_cost_entries_company on cost_entries(company_id);
      create index if not exists idx_cost_entries_run on cost_entries(run_id);
      create index if not exists idx_activity_company on activity(company_id);
      create index if not exists idx_tasks_company_status on tasks(company_id, status);
      create index if not exists idx_agents_company_status on agents(company_id, status);
      create index if not exists idx_agents_reports_to on agents(reports_to);
      create index if not exists idx_runs_company_status on runs(company_id, status);
      create index if not exists idx_approvals_company_state on approvals(company_id, state);
    `);

    this.db.exec(`
      create table if not exists pending_wakes (
        id text primary key,
        company_id text not null,
        agent_id text not null,
        trigger_reason text not null,
        created_at text not null
      );
      create index if not exists idx_pending_wakes_agent on pending_wakes(agent_id);
    `);

    this.migrateSecretsTable();
    this.ensureOptionalColumns();

    this.db.exec(`create index if not exists idx_secrets_company on secrets(company_id);`);

    this.runMigrations();

    // Create indexes that depend on columns added by migrations (e.g., department)
    try {
      this.db.exec(`
        create index if not exists idx_agents_department on agents(company_id, department);
        create index if not exists idx_runs_company_created_at on runs(company_id, created_at desc);
        create index if not exists idx_cost_entries_company_created_at on cost_entries(company_id, created_at desc);
        create index if not exists idx_activity_company_created_at on activity(company_id, created_at desc);
        create index if not exists idx_agent_messages_company_created_at on agent_messages(company_id, created_at desc);
      `);
    } catch { /* column may not exist if migrations failed */ }

    this.seedSettings();
    this.seedConnectors();
    this._lastInterruptedCount = this.interruptStaleRuns();
    this.purgeExpiredRunLogs();
    this.purgeExpiredPendingWakes();
  }

  close() {
    this.db.close();
  }

  getCurrentCompanyId() {
    return this.getSetting("current_company_id");
  }

  setCurrentCompany(companyId: string) {
    this.setSetting("current_company_id", companyId);
  }

  hasCompany(companyId: string) {
    const row = this.db.prepare("select id from companies where id = ?").get(companyId) as { id: string } | undefined;
    return Boolean(row);
  }

  belongsToCompany(table: "workspaces" | "agents" | "goals" | "projects" | "tasks" | "approvals" | "runs" | "secrets" | "meetings" | "documents" | "knowledge_base" | "sprints" | "automation_rules" | "workflow_pipelines", id: string, companyId: string) {
    const queries: Record<string, string> = {
      workspaces: "select 1 as present from workspaces where id = ? and company_id = ?",
      agents: "select 1 as present from agents where id = ? and company_id = ?",
      goals: "select 1 as present from goals where id = ? and company_id = ?",
      projects: "select 1 as present from projects where id = ? and company_id = ?",
      tasks: "select 1 as present from tasks where id = ? and company_id = ?",
      approvals: "select 1 as present from approvals where id = ? and company_id = ?",
      runs: "select 1 as present from runs where id = ? and company_id = ?",
      secrets: "select 1 as present from secrets where id = ? and company_id = ?",
      meetings: "select 1 as present from meetings where id = ? and company_id = ?",
      documents: "select 1 as present from documents where id = ? and company_id = ?",
      knowledge_base: "select 1 as present from knowledge_base where id = ? and company_id = ?",
      sprints: "select 1 as present from sprints where id = ? and company_id = ?",
      automation_rules: "select 1 as present from automation_rules where id = ? and company_id = ?",
      workflow_pipelines: "select 1 as present from workflow_pipelines where id = ? and company_id = ?",
    };
    const sql = queries[table];
    if (!sql) throw new Error(`Unknown table: ${table}`);
    const row = this.db.prepare(sql).get(id, companyId) as { present: number } | undefined;
    return Boolean(row?.present);
  }

  hasActiveRun(filter: { companyId: string; taskId?: string; agentId?: string }) {
    const whereClauses = ["company_id = ?", "status in ('queued', 'running')"];
    const params: SQLInputValue[] = [filter.companyId];
    if (filter.taskId) {
      whereClauses.push("task_id = ?");
      params.push(filter.taskId);
    }
    if (filter.agentId) {
      whereClauses.push("agent_id = ?");
      params.push(filter.agentId);
    }
    const row = this.db.prepare(
      `select 1 as present from runs where ${whereClauses.join(" and ")} limit 1`,
    ).get(...params) as { present: number } | undefined;
    return Boolean(row?.present);
  }

  canOpenPath(targetPath: string) {
    if (!targetPath || !existsSync(targetPath)) {
      return false;
    }

    const managedRoots = [this.profileDir, this.logsDir, this.artifactsDir, this.backupsDir];
    const sensitiveProfileExtensions = new Set([".sqlite", ".db", ".key"]);
    const forbiddenExecutableExtensions = new Set([".app", ".exe", ".bat", ".cmd", ".sh", ".command", ".desktop", ".msi", ".com", ".scr"]);
    const resolvedTarget = safeRealpath(targetPath);
    const targetStats = lstatSync(targetPath);
    const targetExtension = extname(resolvedTarget).toLowerCase();
    if (
      managedRoots.some((rootPath) => isWithinOrEqual(resolvedTarget, rootPath)) &&
      sensitiveProfileExtensions.has(targetExtension)
    ) {
      return false;
    }
    if (!targetStats.isDirectory() && forbiddenExecutableExtensions.has(targetExtension)) {
      return false;
    }
    if (managedRoots.some((rootPath) => isWithinOrEqual(resolvedTarget, safeRealpath(rootPath)))) {
      return true;
    }

    const workspaces = this.readAll<{ localPath: string }>("select local_path as localPath from workspaces");
    if (workspaces.some((workspace) => isWithinOrEqual(resolvedTarget, safeRealpath(workspace.localPath)))) {
      return true;
    }

    const runLogs = this.readAll<{ logPath: string | null }>("select log_path as logPath from runs where log_path is not null");
    return runLogs.some((run) => run.logPath ? safeRealpath(run.logPath) === resolvedTarget : false);
  }

  updateSettings(input: { theme?: "system" | "light" | "dark"; locale?: "en" | "zh"; updatesEnabled?: boolean; logRetentionDays?: number }) {
    if (input.theme) {
      this.setSetting("theme", input.theme);
    }
    if (input.locale) {
      this.setSetting("locale", input.locale);
    }
    if (typeof input.updatesEnabled === "boolean") {
      this.setSetting("updates_enabled", input.updatesEnabled ? "true" : "false");
    }
    if (typeof input.logRetentionDays === "number") {
      this.setSetting("log_retention_days", String(input.logRetentionDays));
    }
  }

  getLogRetentionDays(): number {
    const raw = this.getSetting("log_retention_days");
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : 90; // default 90 days
  }

  purgeExpiredRunLogs(): number {
    const retentionDays = this.getLogRetentionDays();
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    const expiredRuns = this.readAll<{ id: string; logPath: string | null }>(
      "select id, log_path as logPath from runs where finished_at is not null and finished_at < ? and log_path is not null",
      cutoff,
    );
    let purged = 0;
    for (const run of expiredRuns) {
      if (run.logPath) {
        try {
          unlinkSync(run.logPath);
        } catch {
          // Log files may already be gone; continue clearing DB references.
        }
      }
      this.db
        .prepare("update runs set log_path = null, updated_at = ? where id = ?")
        .run(nowIso(), run.id);
      purged++;
    }
    return purged;
  }

  listSnapshot(options: { companyId?: string | null } = {}): ProfileSnapshot {
    const companyId = options.companyId ?? null;
    const companyWhere = companyId ? " where company_id = ?" : "";
    const companyArgs: SQLInputValue[] = companyId ? [companyId] : [];
    const boardReadReceiptParams: SQLInputValue[] = companyId ? [BOARD_READER_ID, companyId] : [BOARD_READER_ID];
    const connectors = this.readConnectors();
    const theme = (this.getSetting("theme") as "system" | "light" | "dark" | null) ?? "system";
    const locale = (this.getSetting("locale") as "en" | "zh" | null) ?? "en";
    const boardReadReceiptMap = new Map(
      this.readAll<{ messageId: string; readAt: string }>(
        `select reads.message_id as messageId, reads.read_at as readAt
           from agent_message_reads reads
           join agent_messages messages on messages.id = reads.message_id
          where reads.agent_id = ?${companyId ? " and messages.company_id = ?" : ""}`,
        ...boardReadReceiptParams,
      ).map((row) => [row.messageId, row.readAt]),
    );
    return {
      currentCompanyId: this.getCurrentCompanyId(),
      profilePath: this.profileDir,
      updatesEnabled: this.getSetting("updates_enabled") !== "false",
      theme,
      locale,
      backend: {
        secretBackend: this.vault.getBackendLabel(),
      },
      companies: this.readAll<CompanyRecord>(
        "select id, name, description, status, auto_approve_hires as autoApproveHires, review_deliverables as reviewDeliverables, created_at as createdAt, updated_at as updatedAt from companies order by created_at asc",
      ).map((record) => ({ ...record, autoApproveHires: toBoolean(record.autoApproveHires), reviewDeliverables: toBoolean(record.reviewDeliverables) })) as CompanyRecord[],
      connectors,
      workspaces: this.readAll<WorkspaceRecord>(
        `select id, company_id as companyId, name, local_path as localPath, repo_url as repoUrl, repo_ref as repoRef, project_id as projectId, state, is_primary as isPrimary, created_at as createdAt, updated_at as updatedAt from workspaces${companyWhere} order by created_at desc`,
        ...companyArgs,
      ).map((record) => ({ ...record, isPrimary: toBoolean(record.isPrimary) })) as WorkspaceRecord[],
      agents: this.readAll<AgentRecord>(
        `select id, company_id as companyId, name, role, title, department, status, reports_to as reportsTo, connector_id as connectorId, workspace_id as workspaceId, model, capabilities, budget_monthly_usd as budgetMonthlyUsd, spent_monthly_usd as spentMonthlyUsd, metadata_json as metadataJson, heartbeat_enabled as heartbeatEnabled, heartbeat_interval_sec as heartbeatIntervalSec, last_heartbeat_at as lastHeartbeatAt, created_at as createdAt, updated_at as updatedAt from agents${companyWhere} order by created_at asc`,
        ...companyArgs,
      ).map((record) => ({ ...record, heartbeatEnabled: toBoolean(record.heartbeatEnabled) })) as AgentRecord[],
      goals: this.readAll<GoalRecord>(
        `select id, company_id as companyId, title, description, parent_id as parentId, owner_agent_id as ownerAgentId, status, created_at as createdAt, updated_at as updatedAt from goals${companyWhere} order by created_at asc`,
        ...companyArgs,
      ),
      projects: this.readAll<ProjectRecord>(
        `select id, company_id as companyId, goal_id as goalId, name, description, lead_agent_id as leadAgentId, status, target_date as targetDate, created_at as createdAt, updated_at as updatedAt from projects${companyWhere} order by created_at desc`,
        ...companyArgs,
      ),
      tasks: this.readAll<TaskRecord>(
        `select id, company_id as companyId, project_id as projectId, goal_id as goalId, parent_id as parentId, title, description, assignee_agent_id as assigneeAgentId, workspace_id as workspaceId, status, priority, active_run_id as activeRunId, session_json as sessionJson, session_display_id as sessionDisplayId, cost_usd as costUsd, requires_user_review as requiresUserReview, created_at as createdAt, updated_at as updatedAt from tasks${companyWhere} order by created_at desc`,
        ...companyArgs,
      ).map((record) => ({ ...record, requiresUserReview: toBoolean(record.requiresUserReview) })) as TaskRecord[],
      approvals: this.readAll<ApprovalRecord>(
        `select id, company_id as companyId, related_task_id as relatedTaskId, related_agent_id as relatedAgentId, requested_by_agent_id as requestedByAgentId, type, payload_summary as payloadSummary, impact_summary as impactSummary, payload_json as payloadJson, decision_note as decisionNote, state, created_at as createdAt, updated_at as updatedAt from approvals${companyWhere} order by created_at desc`,
        ...companyArgs,
      ),
      runs: this.readAll<RunRecord>(
        `select id, company_id as companyId, task_id as taskId, agent_id as agentId, workspace_id as workspaceId, connector_id as connectorId, status, summary, error_message as errorMessage, exit_code as exitCode, signal, model, session_display_id as sessionDisplayId, cost_usd as costUsd, unattributed_cost as unattributedCost, started_at as startedAt, finished_at as finishedAt, log_path as logPath, created_at as createdAt, updated_at as updatedAt from runs${companyWhere} order by created_at desc${companyId ? "" : " limit 500"}`,
        ...companyArgs,
      ).map((record) => ({ ...record, unattributedCost: Boolean(record.unattributedCost) })) as RunRecord[],
      costs: this.readAll<CostRecord>(
        `select id, company_id as companyId, run_id as runId, task_id as taskId, agent_id as agentId, connector_id as connectorId, amount_usd as amountUsd, unattributed, created_at as createdAt from cost_entries${companyWhere} order by created_at desc${companyId ? "" : " limit 500"}`,
        ...companyArgs,
      ).map((entry) => ({ ...entry, unattributed: Boolean(entry.unattributed) })) as CostRecord[],
      activity: this.readAll<ActivityRecord>(
        `select id, company_id as companyId, actor, action, entity_type as entityType, entity_id as entityId, detail, created_at as createdAt from activity${companyWhere} order by created_at desc${companyId ? "" : " limit 250"}`,
        ...companyArgs,
      ),
      secrets: this.readAll<SecretRecord>(
        `select id, company_id as companyId, name, description, backend, updated_at as updatedAt from secrets${companyWhere} order by updated_at desc`,
        ...companyArgs,
      ),
      comments: this.readAll<CommentRecord>(
        `select id, company_id as companyId, task_id as taskId, author_agent_id as authorAgentId, author_name as authorName, body, created_at as createdAt from task_comments${companyWhere} order by created_at asc`,
        ...companyArgs,
      ),
      socialAccounts: this.readAll<SqliteRow>(
        `select id, company_id, platform, account_name, display_name, profile_url, credential_secret_id, status, require_approval, metadata_json, last_used_at, created_at, updated_at from social_accounts${companyWhere} order by created_at desc`,
        ...companyArgs,
      ).map((r) => ({
        id: r.id,
        companyId: r.company_id,
        platform: r.platform,
        accountName: r.account_name,
        displayName: r.display_name,
        profileUrl: r.profile_url,
        credentialSecretId: r.credential_secret_id,
        status: r.status,
        requireApproval: toBoolean(r.require_approval),
        metadataJson: r.metadata_json,
        lastUsedAt: r.last_used_at,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })) as SocialAccountRecord[],
      meetings: this.readAll<SqliteRow>(
        `select id, company_id, type, title, organizer_agent_id, participant_agent_ids, scheduled_at, duration_minutes, agenda_json, notes_json, decisions_json, action_items_json, status, created_at, updated_at from meetings${companyWhere} order by scheduled_at desc`,
        ...companyArgs,
      ).map((r) => ({
        id: r.id, companyId: r.company_id, type: r.type, title: r.title, organizerAgentId: r.organizer_agent_id,
        participantAgentIds: r.participant_agent_ids, scheduledAt: r.scheduled_at, durationMinutes: r.duration_minutes,
        agendaJson: r.agenda_json, notesJson: r.notes_json, decisionsJson: r.decisions_json,
        actionItemsJson: r.action_items_json, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
      })),
      documents: this.readAll<SqliteRow>(
        `select id, company_id, type, title, content, author_agent_id, reviewer_agent_id, project_id, goal_id, parent_doc_id, version, status, tags_json, created_at, updated_at from documents${companyWhere} order by updated_at desc`,
        ...companyArgs,
      ).map((r) => ({
        id: r.id, companyId: r.company_id, type: r.type, title: r.title, content: r.content,
        authorAgentId: r.author_agent_id, reviewerAgentId: r.reviewer_agent_id, projectId: r.project_id,
        goalId: r.goal_id, parentDocId: r.parent_doc_id, version: r.version, status: r.status,
        tagsJson: r.tags_json, createdAt: r.created_at, updatedAt: r.updated_at,
      })),
      knowledgeBase: this.readAll<SqliteRow>(
        `select id, company_id, category, topic, content, author_agent_id, importance, tags_json, referenced_entity_type, referenced_entity_id, created_at, updated_at from knowledge_base${companyWhere} order by updated_at desc`,
        ...companyArgs,
      ).map((r) => ({
        id: r.id, companyId: r.company_id, category: r.category, topic: r.topic, content: r.content,
        authorAgentId: r.author_agent_id, importance: r.importance, tagsJson: r.tags_json,
        referencedEntityType: r.referenced_entity_type, referencedEntityId: r.referenced_entity_id,
        createdAt: r.created_at, updatedAt: r.updated_at,
      })),
      sprints: this.readAll<SqliteRow>(
        `select id, company_id, name, goal, start_date, end_date, status, retrospective_notes, velocity_points, completed_points, created_at, updated_at from sprints${companyWhere} order by start_date desc`,
        ...companyArgs,
      ).map((r) => ({
        id: r.id, companyId: r.company_id, name: r.name, goal: r.goal,
        startDate: r.start_date, endDate: r.end_date, status: r.status,
        retrospectiveNotes: r.retrospective_notes, velocityPoints: r.velocity_points,
        completedPoints: r.completed_points, createdAt: r.created_at, updatedAt: r.updated_at,
      })),
      automationRules: this.readAll<SqliteRow>(
        `select id, company_id, name, description, trigger, conditions_json, action, action_config_json, source_department, target_department, priority, status, execution_count, last_executed_at, created_at, updated_at from automation_rules${companyWhere} order by priority desc, created_at desc`,
        ...companyArgs,
      ).map((r) => ({
        id: r.id, companyId: r.company_id, name: r.name, description: r.description,
        trigger: r.trigger, conditionsJson: r.conditions_json, action: r.action,
        actionConfigJson: r.action_config_json, sourceDepartment: r.source_department,
        targetDepartment: r.target_department, priority: r.priority, status: r.status,
        executionCount: r.execution_count, lastExecutedAt: r.last_executed_at,
        createdAt: r.created_at, updatedAt: r.updated_at,
      })),
      agentMessages: this.readAll<SqliteRow>(
        `select id, company_id, from_agent_id, to_agent_id, channel, channel_target_id, subject, body, priority, read_at, parent_message_id, attachments_json, created_at from agent_messages${companyWhere} order by created_at desc${companyId ? "" : " limit 500"}`,
        ...companyArgs,
      ).map((r) => ({
        id: r.id, companyId: r.company_id, fromAgentId: r.from_agent_id,
        toAgentId: r.to_agent_id, channel: r.channel, channelTargetId: r.channel_target_id,
        subject: r.subject, body: r.body, priority: r.priority, readAt: boardReadReceiptMap.get(r.id) ?? null,
        parentMessageId: r.parent_message_id, attachmentsJson: r.attachments_json,
        createdAt: r.created_at,
      })),
      workflows: this.readAll<SqliteRow>(
        `select id, company_id, name, description, steps_json, trigger_type, trigger_config_json, status, current_step_index, run_count, last_run_at, created_at, updated_at from workflow_pipelines${companyWhere} order by created_at desc`,
        ...companyArgs,
      ).map((r) => ({
        id: r.id, companyId: r.company_id, name: r.name, description: r.description,
        stepsJson: r.steps_json, triggerType: r.trigger_type, triggerConfigJson: r.trigger_config_json,
        status: r.status, currentStepIndex: r.current_step_index, runCount: r.run_count,
        lastRunAt: r.last_run_at, createdAt: r.created_at, updatedAt: r.updated_at,
      })),
    };
  }

  listRendererSnapshot(): ProfileSnapshot {
    const currentCompanyId = this.getCurrentCompanyId();
    if (!currentCompanyId) {
      return this.listSnapshot();
    }
    const snapshot = this.listSnapshot({ companyId: currentCompanyId });
    const companyId = snapshot.currentCompanyId;
    if (!companyId) {
      return snapshot;
    }
    return snapshot;
  }

  saveCompany(input: { id?: string | null; name: string; description: string; status: string; autoApproveHires?: boolean; reviewDeliverables?: boolean }) {
    const id = ensureId(input.id ?? null);
    const ts = nowIso();
    const autoApprove = input.autoApproveHires ? 1 : 0;
    const reviewDeliverables = input.reviewDeliverables ? 1 : 0;
    const existing = this.db.prepare("select id from companies where id = ?").get(id) as { id: string } | undefined;
    if (existing) {
      this.db
        .prepare("update companies set name = ?, description = ?, status = ?, auto_approve_hires = ?, review_deliverables = ?, updated_at = ? where id = ?")
        .run(input.name, input.description, input.status, autoApprove, reviewDeliverables, ts, id);
    } else {
      this.db
        .prepare("insert into companies (id, name, description, status, auto_approve_hires, review_deliverables, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, input.name, input.description, input.status, autoApprove, reviewDeliverables, ts, ts);
      if (!this.getCurrentCompanyId()) {
        this.setCurrentCompany(id);
      }
    }
    return id;
  }

  saveConnector(input: {
    id: ConnectorId;
    command: string;
    model: string | null;
    envBindingText: string;
    notes: string;
  }) {
    this.db
      .prepare(
        "update connectors set command = ?, model = ?, env_binding_text = ?, notes = ?, updated_at = ? where id = ?",
      )
      .run(input.command, input.model, input.envBindingText, input.notes, nowIso(), input.id);
  }

  updateConnectorHealth(input: {
    id: ConnectorId;
    status: string;
    authState: string;
    version: string | null;
    lastError: string | null;
  }) {
    this.db
      .prepare(
        "update connectors set status = ?, auth_state = ?, version = ?, last_checked_at = ?, last_error = ?, updated_at = ? where id = ?",
      )
      .run(input.status, input.authState, input.version, nowIso(), input.lastError, nowIso(), input.id);
  }

  saveWorkspace(input: {
    id?: string | null;
    companyId: string;
    name: string;
    localPath: string;
    repoUrl: string;
    repoRef: string;
    projectId?: string | null;
    isPrimary: boolean;
  }) {
    const id = ensureId(input.id ?? null);
    const ts = nowIso();
    if (input.isPrimary) {
      this.db.prepare("update workspaces set is_primary = 0 where company_id = ?").run(input.companyId);
    }
    const existing = this.db.prepare("select id from workspaces where id = ? and company_id = ?").get(id, input.companyId) as { id: string } | undefined;
    if (existing) {
      this.db
        .prepare(
          "update workspaces set name = ?, local_path = ?, repo_url = ?, repo_ref = ?, project_id = ?, is_primary = ?, updated_at = ? where id = ? and company_id = ?",
        )
        .run(input.name, input.localPath, input.repoUrl, input.repoRef, normalizeOptionalId(input.projectId), input.isPrimary ? 1 : 0, ts, id, input.companyId);
    } else {
      this.db
        .prepare(
          "insert into workspaces (id, company_id, name, local_path, repo_url, repo_ref, project_id, state, is_primary, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)",
        )
        .run(id, input.companyId, input.name, input.localPath, input.repoUrl, input.repoRef, normalizeOptionalId(input.projectId), input.isPrimary ? 1 : 0, ts, ts);
    }
    return id;
  }

  saveAgent(input: {
    id?: string | null;
    companyId: string;
    name: string;
    role: string;
    title: string;
    department?: string | null;
    status: AgentRecord["status"];
    reportsTo?: string | null;
    connectorId: ConnectorId;
    workspaceId?: string | null;
    model?: string | null;
    metadataJson?: string;
    capabilities: string;
    budgetMonthlyUsd: number;
  }) {
    const id = ensureId(input.id ?? null);
    const ts = nowIso();
    const metadataJson = input.metadataJson ?? "{}";
    const department = input.department ?? null;
    const reportsTo = normalizeOptionalId(input.reportsTo);
    if (this.wouldCreateAgentCycle(id, reportsTo)) {
      throw new Error("Agent reporting relationship would create a cycle.");
    }
    const existing = this.db.prepare("select id from agents where id = ? and company_id = ?").get(id, input.companyId) as { id: string } | undefined;
    if (existing) {
      this.db
        .prepare(
          "update agents set name = ?, role = ?, title = ?, department = ?, status = ?, reports_to = ?, connector_id = ?, workspace_id = ?, model = ?, metadata_json = ?, capabilities = ?, budget_monthly_usd = ?, updated_at = ? where id = ? and company_id = ?",
        )
        .run(
          input.name,
          input.role,
          input.title,
          department,
          input.status,
          reportsTo,
          input.connectorId,
          normalizeOptionalId(input.workspaceId),
          normalizeOptionalId(input.model),
          metadataJson,
          input.capabilities,
          input.budgetMonthlyUsd,
          ts,
          id,
          input.companyId,
        );
    } else {
      this.db
        .prepare(
          "insert into agents (id, company_id, name, role, title, department, status, reports_to, connector_id, workspace_id, model, capabilities, budget_monthly_usd, spent_monthly_usd, metadata_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)",
        )
        .run(
          id,
          input.companyId,
          input.name,
          input.role,
          input.title,
          department,
          input.status,
          reportsTo,
          input.connectorId,
          normalizeOptionalId(input.workspaceId),
          normalizeOptionalId(input.model),
          input.capabilities,
          input.budgetMonthlyUsd,
          metadataJson,
          ts,
          ts,
        );
    }
    return id;
  }

  createHireRequest(input: {
    companyId: string;
    requestedByAgentId?: string | null;
    name: string;
    role: string;
    title: string;
    department?: string | null;
    reportsTo?: string | null;
    connectorId: ConnectorId;
    workspaceId?: string | null;
    model?: string | null;
    metadataJson?: string;
    capabilities: string;
    budgetMonthlyUsd: number;
    payloadSummary: string;
    impactSummary: string;
    payloadJson?: string | null;
  }) {
    return this.transaction(() => {
      const agentId = this.saveAgent({
        companyId: input.companyId,
        name: input.name,
        role: input.role,
        title: input.title,
        department: input.department ?? null,
        status: "pending_approval",
        reportsTo: input.reportsTo ?? null,
        connectorId: input.connectorId,
        workspaceId: input.workspaceId ?? null,
        model: input.model ?? null,
        metadataJson: input.metadataJson ?? "{}",
        capabilities: input.capabilities,
        budgetMonthlyUsd: input.budgetMonthlyUsd,
      });
      const approvalId = this.requestApproval({
        companyId: input.companyId,
        requestedByAgentId: input.requestedByAgentId ?? null,
        relatedAgentId: agentId,
        type: "hire_agent",
        payloadSummary: input.payloadSummary,
        impactSummary: input.impactSummary,
        payloadJson: input.payloadJson ?? null,
      });
      return { agentId, approvalId };
    });
  }

  saveGoal(input: { id?: string | null; companyId: string; title: string; description: string; parentId?: string | null; ownerAgentId?: string | null; status: string }) {
    const id = ensureId(input.id ?? null);
    const ts = nowIso();
    const existing = this.db.prepare("select id from goals where id = ? and company_id = ?").get(id, input.companyId) as { id: string } | undefined;
    if (existing) {
      this.db
        .prepare(
          "update goals set title = ?, description = ?, parent_id = ?, owner_agent_id = ?, status = ?, updated_at = ? where id = ? and company_id = ?",
        )
        .run(input.title, input.description, normalizeOptionalId(input.parentId), normalizeOptionalId(input.ownerAgentId), input.status, ts, id, input.companyId);
    } else {
      this.db
        .prepare(
          "insert into goals (id, company_id, title, description, parent_id, owner_agent_id, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(id, input.companyId, input.title, input.description, normalizeOptionalId(input.parentId), normalizeOptionalId(input.ownerAgentId), input.status, ts, ts);
    }
    return id;
  }

  saveProject(input: { id?: string | null; companyId: string; goalId?: string | null; name: string; description: string; leadAgentId?: string | null; targetDate?: string | null; status: string }) {
    const id = ensureId(input.id ?? null);
    const ts = nowIso();
    const existing = this.db.prepare("select id from projects where id = ? and company_id = ?").get(id, input.companyId) as { id: string } | undefined;
    if (existing) {
      this.db
        .prepare(
          "update projects set goal_id = ?, name = ?, description = ?, lead_agent_id = ?, status = ?, target_date = ?, updated_at = ? where id = ? and company_id = ?",
        )
        .run(normalizeOptionalId(input.goalId), input.name, input.description, normalizeOptionalId(input.leadAgentId), input.status, normalizeOptionalId(input.targetDate), ts, id, input.companyId);
    } else {
      this.db
        .prepare(
          "insert into projects (id, company_id, goal_id, name, description, lead_agent_id, status, target_date, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(id, input.companyId, normalizeOptionalId(input.goalId), input.name, input.description, normalizeOptionalId(input.leadAgentId), input.status, normalizeOptionalId(input.targetDate), ts, ts);
    }
    return id;
  }

  saveTask(input: {
    id?: string | null;
    companyId: string;
    projectId?: string | null;
    goalId?: string | null;
    parentId?: string | null;
    title: string;
    description: string;
    assigneeAgentId?: string | null;
    workspaceId?: string | null;
    priority: string;
    status: string;
  }) {
    const id = ensureId(input.id ?? null);
    const ts = nowIso();
    const assigneeAgentId = normalizeOptionalId(input.assigneeAgentId);
    if (input.status === "in_progress" && !assigneeAgentId) {
      throw new Error("Tasks in progress require an assignee.");
    }
    const existing = this.db.prepare("select id from tasks where id = ? and company_id = ?").get(id, input.companyId) as { id: string } | undefined;
    if (existing) {
      this.db
        .prepare(
          "update tasks set project_id = ?, goal_id = ?, parent_id = ?, title = ?, description = ?, assignee_agent_id = ?, workspace_id = ?, priority = ?, status = ?, updated_at = ? where id = ? and company_id = ?",
        )
        .run(normalizeOptionalId(input.projectId), normalizeOptionalId(input.goalId), normalizeOptionalId(input.parentId), input.title, input.description, assigneeAgentId, normalizeOptionalId(input.workspaceId), input.priority, input.status, ts, id, input.companyId);
    } else {
      this.db
        .prepare(
          "insert into tasks (id, company_id, project_id, goal_id, parent_id, title, description, assignee_agent_id, workspace_id, status, priority, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(id, input.companyId, normalizeOptionalId(input.projectId), normalizeOptionalId(input.goalId), normalizeOptionalId(input.parentId), input.title, input.description, assigneeAgentId, normalizeOptionalId(input.workspaceId), input.status, input.priority, ts, ts);
    }
    return id;
  }

  requestApproval(input: {
    companyId: string;
    relatedTaskId?: string | null;
    requestedByAgentId?: string | null;
    relatedAgentId?: string | null;
    type: string;
    payloadSummary: string;
    impactSummary: string;
    payloadJson?: string | null;
  }) {
    const id = randomUUID();
    const ts = nowIso();
    let relatedAgentId = normalizeOptionalId(input.relatedAgentId);
    if (!relatedAgentId && input.type === "hire_agent" && input.payloadJson) {
      try {
        const payload = JSON.parse(input.payloadJson) as { agentId?: string };
        relatedAgentId = payload.agentId ?? null;
      } catch { /* ignore malformed payload */ }
    }
    if (input.type === "hire_agent") {
      if (!relatedAgentId) {
        throw new Error("hire_agent approvals require a linked pending agent.");
      }
      const agent = this.getAgent(relatedAgentId);
      if (agent.companyId !== input.companyId) {
        throw new Error(`Agent ${relatedAgentId} does not belong to company ${input.companyId}.`);
      }
      if (agent.status !== "pending_approval") {
        throw new Error(`hire_agent approvals can only target agents pending approval. Current status: ${agent.status}.`);
      }
    }
    this.db
      .prepare(
        "insert into approvals (id, company_id, related_task_id, requested_by_agent_id, related_agent_id, type, payload_summary, impact_summary, payload_json, decision_note, state, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'pending', ?, ?)",
      )
      .run(
        id,
        input.companyId,
        normalizeOptionalId(input.relatedTaskId),
        normalizeOptionalId(input.requestedByAgentId),
        relatedAgentId,
        input.type,
        input.payloadSummary,
        input.impactSummary,
        input.payloadJson ?? null,
        ts,
        ts,
      );
    return id;
  }

  decideApproval(input: { companyId?: string | null; approvalId: string; state: string; decisionNote: string }) {
    const approval = this.getApprovalRecord(input.approvalId);
    if (input.companyId && approval.companyId !== input.companyId) {
      throw new Error(`Approval ${input.approvalId} does not belong to company ${input.companyId}.`);
    }
    if (!["pending", "revision_requested"].includes(approval.state)) {
      throw new Error(`Approval ${input.approvalId} is already ${approval.state} and cannot be re-decided.`);
    }
    const ts = nowIso();
    this.transaction(() => {
      this.db
        .prepare("update approvals set state = ?, decision_note = ?, updated_at = ? where id = ?")
        .run(input.state, input.decisionNote, ts, input.approvalId);
      if (approval.type === "hire_agent") {
        const agentId = approval.relatedAgentId
          ?? parseJson<{ agentId?: string } | null>(approval.payloadJson, null)?.agentId
          ?? null;
        if (!agentId) {
          throw new Error(`hire_agent approval ${input.approvalId} has no linked agent — cannot resolve hire target. Ensure relatedAgentId or payloadJson.agentId is set.`);
        }
        if (input.state === "approved") {
          const result = this.db
            .prepare("update agents set status = 'idle', updated_at = ? where id = ? and company_id = ? and status = 'pending_approval'")
            .run(ts, agentId, approval.companyId);
          if (result.changes === 0) {
            throw new Error(`hire_agent approval ${input.approvalId} could not activate agent ${agentId}; the agent is missing or no longer pending approval.`);
          }
        }
        if (input.state === "rejected") {
          const result = this.db
            .prepare("update agents set status = 'terminated', updated_at = ? where id = ? and company_id = ? and status = 'pending_approval'")
            .run(ts, agentId, approval.companyId);
          if (result.changes === 0) {
            throw new Error(`hire_agent approval ${input.approvalId} could not reject agent ${agentId}; the agent is missing or no longer pending approval.`);
          }
        }
      }
    });
  }

  saveSecret(input: { id?: string | null; companyId: string; name: string; description: string; value: string }) {
    const id = ensureId(input.id ?? null);
    const encrypted = this.vault.encrypt(input.value);
    const ts = nowIso();
    const existing = this.db.prepare("select id, company_id as companyId from secrets where id = ?").get(id) as
      | { id: string; companyId: string }
      | undefined;
    if (existing) {
      if (existing.companyId !== input.companyId) {
        throw new Error("Secrets cannot be moved across companies.");
      }
      this.db
        .prepare("update secrets set name = ?, description = ?, backend = ?, ciphertext = ?, updated_at = ? where id = ? and company_id = ?")
        .run(input.name, input.description, encrypted.backend, encrypted.payload, ts, id, input.companyId);
    } else {
      this.db
        .prepare("insert into secrets (id, company_id, name, description, backend, ciphertext, updated_at, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(id, input.companyId, input.name, input.description, encrypted.backend, encrypted.payload, ts, ts);
    }
    return id;
  }

  resolveSecretEnv(bindingText: string, companyId: string): Record<string, string> {
    const invalidKeys = new Set(listInvalidEnvBindingKeys(bindingText));
    const bindings = parseEnvBindingText(bindingText);
    const result: Record<string, string> = {};
    for (const [envKey, rawValue] of Object.entries(bindings)) {
      if (invalidKeys.has(envKey)) {
        continue;
      }
      // First try to resolve as a secret name from the vault.
      const row = this.db.prepare("select backend, ciphertext from secrets where company_id = ? and name = ?").get(companyId, rawValue) as
        | { backend: "safe_storage" | "vault"; ciphertext: Uint8Array }
        | undefined;
      if (row) {
        result[envKey] = this.vault.decrypt(row.backend, Buffer.from(row.ciphertext));
      } else {
        // No matching secret — use the value literally.
        // This allows direct env bindings like ANTHROPIC_API_KEY=sk-ant-xxx
        // without requiring a stored secret entry.
        result[envKey] = rawValue;
      }
    }
    return result;
  }

  getConnector(id: ConnectorId): ConnectorRecord {
    const record = this.readConnectors().find((entry) => entry.id === id);
    if (!record) throw new Error(`Connector not found: ${id}`);
    return record;
  }

  getTask(id: string): TaskRecord {
    const row = this.db
      .prepare(
        "select id, company_id as companyId, project_id as projectId, goal_id as goalId, parent_id as parentId, title, description, assignee_agent_id as assigneeAgentId, workspace_id as workspaceId, status, priority, active_run_id as activeRunId, session_json as sessionJson, session_display_id as sessionDisplayId, cost_usd as costUsd, requires_user_review as requiresUserReview, created_at as createdAt, updated_at as updatedAt from tasks where id = ?",
      )
      .get(id) as TaskRecord | undefined;
    if (!row) throw new Error(`Task not found: ${id}`);
    row.requiresUserReview = Boolean(row.requiresUserReview);
    return row;
  }

  getApprovalRecord(id: string) {
    const row = this.db
      .prepare(
        "select id, company_id as companyId, related_task_id as relatedTaskId, requested_by_agent_id as requestedByAgentId, related_agent_id as relatedAgentId, type, payload_summary as payloadSummary, impact_summary as impactSummary, payload_json as payloadJson, decision_note as decisionNote, state, created_at as createdAt, updated_at as updatedAt from approvals where id = ?",
      )
      .get(id) as (ApprovalRecord & { payloadJson: string | null; relatedAgentId: string | null }) | undefined;
    if (!row) throw new Error(`Approval not found: ${id}`);
    return row;
  }

  getAgent(id: string): AgentRecord {
    const row = this.db
      .prepare(
        "select id, company_id as companyId, name, role, title, department, status, reports_to as reportsTo, connector_id as connectorId, workspace_id as workspaceId, model, capabilities, budget_monthly_usd as budgetMonthlyUsd, spent_monthly_usd as spentMonthlyUsd, metadata_json as metadataJson, heartbeat_enabled as heartbeatEnabled, heartbeat_interval_sec as heartbeatIntervalSec, last_heartbeat_at as lastHeartbeatAt, created_at as createdAt, updated_at as updatedAt from agents where id = ?",
      )
      .get(id) as AgentRecord | undefined;
    if (!row) throw new Error(`Agent not found: ${id}`);
    return row;
  }

  getWorkspace(id: string | null | undefined): WorkspaceRecord | null {
    if (!id) return null;
    const row = this.db
      .prepare(
        "select id, company_id as companyId, name, local_path as localPath, repo_url as repoUrl, repo_ref as repoRef, project_id as projectId, state, is_primary as isPrimary, created_at as createdAt, updated_at as updatedAt from workspaces where id = ?",
      )
      .get(id) as WorkspaceRecord | undefined;
    return row ? { ...row, isPrimary: toBoolean(row.isPrimary) } : null;
  }

  getProjectPrimaryWorkspace(projectId: string | null | undefined, companyId: string): WorkspaceRecord | null {
    if (!projectId) {
      return null;
    }

    const row = this.db
      .prepare(
        "select id, company_id as companyId, name, local_path as localPath, repo_url as repoUrl, repo_ref as repoRef, project_id as projectId, state, is_primary as isPrimary, created_at as createdAt, updated_at as updatedAt from workspaces where company_id = ? and project_id = ? order by is_primary desc, created_at asc limit 1",
      )
      .get(companyId, projectId) as WorkspaceRecord | undefined;
    return row ? { ...row, isPrimary: toBoolean(row.isPrimary) } : null;
  }

  getAnyCompanyWorkspace(companyId: string): WorkspaceRecord | null {
    const row = this.db
      .prepare(
        "select id, company_id as companyId, name, local_path as localPath, repo_url as repoUrl, repo_ref as repoRef, project_id as projectId, state, is_primary as isPrimary, created_at as createdAt, updated_at as updatedAt from workspaces where company_id = ? order by is_primary desc, created_at asc limit 1",
      )
      .get(companyId) as WorkspaceRecord | undefined;
    return row ? { ...row, isPrimary: toBoolean(row.isPrimary) } : null;
  }

  getRunAuthState(runId: string): { id: string; companyId: string; agentId: string; status: RunRecord["status"] } | null {
    const row = this.db
      .prepare("select id, company_id as companyId, agent_id as agentId, status from runs where id = ?")
      .get(runId) as { id: string; companyId: string; agentId: string; status: RunRecord["status"] } | undefined;
    return row ?? null;
  }

  createRun(input: {
    companyId: string;
    taskId: string;
    agentId: string;
    workspaceId: string | null;
    connectorId: ConnectorId;
  }) {
    const id = randomUUID();
    const ts = nowIso();
    const logPath = join(this.logsDir, `${id}.log`);
    this.transaction(() => {
      this.db
        .prepare(
          "insert into runs (id, company_id, task_id, agent_id, workspace_id, connector_id, status, summary, unattributed_cost, log_path, created_at, updated_at) values (?, ?, ?, ?, ?, ?, 'queued', '', 0, ?, ?, ?)",
        )
        .run(id, input.companyId, input.taskId, input.agentId, input.workspaceId, input.connectorId, logPath, ts, ts);
      this.db.prepare("update tasks set active_run_id = ?, updated_at = ? where id = ?").run(id, ts, input.taskId);
    });
    writeFileSync(logPath, "", "utf8");
    return { id, logPath };
  }

  appendRunLog(runId: string, stream: "stdout" | "stderr", chunk: string) {
    const run = this.db.prepare("select log_path as logPath from runs where id = ?").get(runId) as { logPath: string | null } | undefined;
    if (!run?.logPath) return;
    return appendFile(run.logPath, `[${new Date().toISOString()}][${stream}] ${chunk}`, "utf8");
  }

  readRunLog(runId: string) {
    const run = this.db.prepare("select log_path as logPath from runs where id = ?").get(runId) as { logPath: string | null } | undefined;
    if (!run?.logPath) return "";
    try {
      return readFileSync(run.logPath, "utf8");
    } catch {
      return "";
    }
  }

  readRunLogChunk(runId: string, offset = 0, limit = 65_536): RunLogChunk {
    const run = this.db.prepare("select log_path as logPath from runs where id = ?").get(runId) as { logPath: string | null } | undefined;
    if (!run?.logPath || !existsSync(run.logPath)) {
      return {
        content: "",
        offset: 0,
        nextOffset: 0,
        totalBytes: 0,
        eof: true,
      };
    }

    const totalBytes = statSync(run.logPath).size;
    const safeOffset = Math.max(0, Math.min(offset, totalBytes));
    const safeLimit = Math.max(1_024, Math.min(limit, 262_144));
    const bytesToRead = Math.max(0, Math.min(safeLimit, totalBytes - safeOffset));

    if (bytesToRead === 0) {
      return {
        content: "",
        offset: safeOffset,
        nextOffset: safeOffset,
        totalBytes,
        eof: true,
      };
    }

    const fileDescriptor = openSync(run.logPath, "r");
    try {
      const buffer = Buffer.allocUnsafe(bytesToRead);
      const bytesRead = readSync(fileDescriptor, buffer, 0, bytesToRead, safeOffset);
      // Find the last complete UTF-8 character boundary to avoid corrupting
      // multi-byte characters (e.g. Chinese/CJK 3-byte sequences) at the edge.
      const safeBytesRead = findUtf8Boundary(buffer, bytesRead);
      const nextOffset = safeOffset + safeBytesRead;
      return {
        content: buffer.subarray(0, safeBytesRead).toString("utf8"),
        offset: safeOffset,
        nextOffset,
        totalBytes,
        eof: nextOffset >= totalBytes,
      };
    } finally {
      closeSync(fileDescriptor);
    }
  }

  markRunStatus(runId: string, status: RunRecord["status"], message: string) {
    const ts = nowIso();
    const startedAt = status === "running" ? ts : null;
    this.transaction(() => {
      this.db
        .prepare(
          "update runs set status = ?, summary = case when ? != '' then ? else summary end, started_at = coalesce(started_at, ?), updated_at = ? where id = ?",
        )
        .run(status, message, message, startedAt, ts, runId);

      if (status === "running") {
        const run = this.db.prepare("select agent_id from runs where id = ?").get(runId) as { agent_id: string } | undefined;
        if (run) {
          this.db
            .prepare("update agents set status = 'running', updated_at = ? where id = ? and status in ('idle', 'active')")
            .run(ts, run.agent_id);
        }
      }
    });
  }

  finishRun(input: {
    runId: string;
    status: RunRecord["status"];
    summary: string | null;
    errorMessage: string | null;
    exitCode: number | null;
    signal: string | null;
    model: string | null;
    sessionDisplayId: string | null;
    costUsd: number | null;
    unattributedCost: boolean;
  }) {
    const run = this.db.prepare("select task_id as taskId, agent_id as agentId, company_id as companyId, connector_id as connectorId from runs where id = ?").get(input.runId) as
      | { taskId: string; agentId: string; companyId: string; connectorId: ConnectorId }
      | undefined;
    if (!run) return { budgetHardStopped: false };
    const ts = nowIso();
    const agent = this.db.prepare(
      "select budget_monthly_usd as budgetMonthlyUsd, spent_monthly_usd as spentMonthlyUsd, status from agents where id = ?",
    ).get(run.agentId) as { budgetMonthlyUsd: number; spentMonthlyUsd: number; status: AgentRecord["status"] } | undefined;
    const nextSpend =
      agent && typeof input.costUsd === "number" && Number.isFinite(input.costUsd)
        ? agent.spentMonthlyUsd + input.costUsd
        : agent?.spentMonthlyUsd ?? 0;
    const budgetHardStopped = Boolean(
      agent &&
      agent.budgetMonthlyUsd > 0 &&
      nextSpend >= agent.budgetMonthlyUsd &&
      agent.status !== "paused" &&
      agent.status !== "terminated",
    );
    this.transaction(() => {
      this.db
        .prepare(
          "update runs set status = ?, summary = ?, error_message = ?, exit_code = ?, signal = ?, model = ?, session_display_id = ?, cost_usd = ?, unattributed_cost = ?, finished_at = ?, updated_at = ? where id = ?",
        )
        .run(
          input.status,
          input.summary ?? "",
          input.errorMessage,
          input.exitCode,
          input.signal,
          input.model,
          input.sessionDisplayId,
          input.costUsd,
          input.unattributedCost ? 1 : 0,
          ts,
          ts,
          input.runId,
        );
      this.db.prepare("update tasks set active_run_id = null, updated_at = ? where id = ?").run(ts, run.taskId);
      if (typeof input.costUsd === "number" && Number.isFinite(input.costUsd)) {
        this.db
          .prepare("update tasks set cost_usd = cost_usd + ?, updated_at = ? where id = ?")
          .run(input.costUsd, ts, run.taskId);
        this.db
          .prepare("update agents set spent_monthly_usd = spent_monthly_usd + ?, updated_at = ? where id = ?")
          .run(input.costUsd, ts, run.agentId);
        this.db
          .prepare(
            "update agents set status = case when budget_monthly_usd > 0 and (spent_monthly_usd + ?) >= budget_monthly_usd then 'paused' else status end, updated_at = ? where id = ?",
          )
          .run(input.costUsd, ts, run.agentId);
      }
      this.db
          .prepare("insert into cost_entries (id, company_id, run_id, task_id, agent_id, connector_id, amount_usd, unattributed, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(randomUUID(), run.companyId, input.runId, run.taskId, run.agentId, run.connectorId, input.costUsd, input.unattributedCost ? 1 : 0, ts);
      if (budgetHardStopped) {
        this.db
          .prepare("update agents set status = 'paused', updated_at = ? where id = ?")
          .run(ts, run.agentId);
      } else {
        // Reset agent status from "running" back to "idle" unless paused/terminated/pending_approval
        this.db
          .prepare("update agents set status = 'idle', updated_at = ? where id = ? and status = 'running'")
          .run(ts, run.agentId);
      }
    });
    return { budgetHardStopped };
  }

  private cancelRunForDeletion(runId: string, taskId: string, workspaceId: string | null, summary: string) {
    const ts = nowIso();
    this.db
      .prepare(
        "update runs set status = 'cancelled', summary = ?, error_message = null, exit_code = null, signal = null, model = null, session_display_id = null, cost_usd = null, unattributed_cost = 1, finished_at = ?, updated_at = ? where id = ?",
      )
      .run(summary, ts, ts, runId);
    this.db.prepare("update tasks set active_run_id = null, updated_at = ? where id = ?").run(ts, taskId);
    if (workspaceId) {
      this.db
        .prepare(
          `update workspaces
             set lock_holder_run_id = null, lock_acquired_at = null, state = 'ready', updated_at = ?
           where id = ? and lock_holder_run_id = ?`,
        )
        .run(ts, workspaceId, runId);
    }
  }

  updateTaskSession(taskId: string, sessionJson: Record<string, unknown> | null, sessionDisplayId: string | null) {
    this.db
      .prepare("update tasks set session_json = ?, session_display_id = ?, updated_at = ? where id = ?")
      .run(sessionJson ? JSON.stringify(sessionJson) : null, sessionDisplayId, nowIso(), taskId);
  }

  getTaskSession(taskId: string) {
    const row = this.db.prepare("select session_json as sessionJson, session_display_id as sessionDisplayId from tasks where id = ?").get(taskId) as
      | { sessionJson: string | null; sessionDisplayId: string | null }
      | undefined;
    return {
      sessionParams: parseJson<Record<string, unknown> | null>(row?.sessionJson, null),
      sessionDisplayId: row?.sessionDisplayId ?? null,
    };
  }

  addActivity(input: { companyId: string; actor: string; action: string; entityType: string; entityId: string; detail: string }) {
    this.db
      .prepare("insert into activity (id, company_id, actor, action, entity_type, entity_id, detail, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(randomUUID(), input.companyId, input.actor, input.action, input.entityType, input.entityId, input.detail, nowIso());
  }

  deleteCompany(companyId: string) {
    this.transaction(() => {
      try {
        this.db.prepare(
          "delete from agent_message_reads where message_id in (select id from agent_messages where company_id = ?)",
        ).run(companyId);
      } catch (err) {
        if (!(err instanceof Error) || !err.message.includes("no such table")) throw err;
      }
      this.db.prepare("delete from pending_wakes where company_id = ?").run(companyId);
      this.db.prepare("delete from cost_entries where company_id = ?").run(companyId);
      this.db.prepare("delete from activity where company_id = ?").run(companyId);
      this.db.prepare("delete from task_comments where company_id = ?").run(companyId);
      this.db.prepare("delete from runs where company_id = ?").run(companyId);
      this.db.prepare("delete from approvals where company_id = ?").run(companyId);
      this.db.prepare("delete from tasks where company_id = ?").run(companyId);
      this.db.prepare("delete from projects where company_id = ?").run(companyId);
      this.db.prepare("delete from goals where company_id = ?").run(companyId);
      this.db.prepare("delete from agents where company_id = ?").run(companyId);
      this.db.prepare("delete from secrets where company_id = ?").run(companyId);
      this.db.prepare("delete from workspaces where company_id = ?").run(companyId);
      for (const table of ["automation_rules", "automation_log", "agent_messages", "workflow_pipelines", "meetings", "documents", "knowledge_base", "sprints", "browser_actions", "social_accounts"]) {
        try {
          this.db.prepare(`delete from ${table} where company_id = ?`).run(companyId);
        } catch (err) {
          // Only tolerate "no such table" — re-throw anything else (disk error, etc.)
          if (!(err instanceof Error) || !err.message.includes("no such table")) throw err;
        }
      }
      this.db.prepare("delete from companies where id = ?").run(companyId);
      if (this.getCurrentCompanyId() === companyId) {
        const next = this.db.prepare("select id from companies order by created_at asc limit 1").get() as { id: string } | undefined;
        if (next) {
          this.setCurrentCompany(next.id);
        } else {
          this.setSetting("current_company_id", "");
        }
      }
    });
  }

  deleteAgent(id: string, companyId: string) {
    const activeAgentRuns = this.readAll<{ id: string; taskId: string; workspaceId: string | null }>(
      "select id, task_id as taskId, workspace_id as workspaceId from runs where agent_id = ? and company_id = ? and status in ('queued', 'running')",
      id, companyId,
    );
    this.transaction(() => {
      for (const run of activeAgentRuns) {
        this.cancelRunForDeletion(run.id, run.taskId, run.workspaceId, "Agent deleted.");
      }
      this.db.prepare("update tasks set assignee_agent_id = null where assignee_agent_id = ? and company_id = ?").run(id, companyId);
      this.db.prepare("update goals set owner_agent_id = null where owner_agent_id = ? and company_id = ?").run(id, companyId);
      this.db.prepare("update projects set lead_agent_id = null where lead_agent_id = ? and company_id = ?").run(id, companyId);
      this.db.prepare("update agents set reports_to = null where reports_to = ? and company_id = ?").run(id, companyId);
      // Clean up orphaned approvals referencing this agent
      this.db.prepare("update approvals set requested_by_agent_id = null where requested_by_agent_id = ? and company_id = ?").run(id, companyId);
      this.db.prepare("update approvals set related_agent_id = null where related_agent_id = ? and company_id = ?").run(id, companyId);
      // Clean up meetings organized by this agent
      this.db.prepare("update meetings set organizer_agent_id = null where organizer_agent_id = ? and company_id = ?").run(id, companyId);
      // Clean up documents authored/reviewed by this agent
      this.db.prepare("update documents set author_agent_id = null where author_agent_id = ? and company_id = ?").run(id, companyId);
      this.db.prepare("update documents set reviewer_agent_id = null where reviewer_agent_id = ? and company_id = ?").run(id, companyId);
      // Clean up knowledge entries authored by this agent
      this.db.prepare("update knowledge_base set author_agent_id = null where author_agent_id = ? and company_id = ?").run(id, companyId);
      // Remove pending wakes for this agent
      this.db.prepare("delete from pending_wakes where agent_id = ? and company_id = ?").run(id, companyId);
      this.db.prepare("delete from agents where id = ? and company_id = ?").run(id, companyId);
    });
  }

  deleteTask(id: string, companyId: string) {
    const activeTaskRuns = this.readAll<{ id: string; taskId: string; workspaceId: string | null }>(
      "select id, task_id as taskId, workspace_id as workspaceId from runs where task_id = ? and company_id = ? and status in ('queued', 'running')",
      id, companyId,
    );
    this.transaction(() => {
      for (const run of activeTaskRuns) {
        this.cancelRunForDeletion(run.id, run.taskId, run.workspaceId, "Task deleted.");
      }
      this.db.prepare("update tasks set parent_id = null where parent_id = ? and company_id = ?").run(id, companyId);
      this.db.prepare("delete from approvals where related_task_id = ? and company_id = ?").run(id, companyId);
      this.db.prepare("delete from task_comments where task_id = ? and company_id = ?").run(id, companyId);
      this.db.prepare("delete from tasks where id = ? and company_id = ?").run(id, companyId);
    });
  }

  deleteGoal(id: string, companyId: string) {
    this.transaction(() => {
      this.db.prepare("update goals set parent_id = null where parent_id = ? and company_id = ?").run(id, companyId);
      this.db.prepare("update projects set goal_id = null where goal_id = ? and company_id = ?").run(id, companyId);
      this.db.prepare("update tasks set goal_id = null where goal_id = ? and company_id = ?").run(id, companyId);
      this.db.prepare("delete from goals where id = ? and company_id = ?").run(id, companyId);
    });
  }

  deleteProject(id: string, companyId: string) {
    this.transaction(() => {
      this.db.prepare("update tasks set project_id = null where project_id = ? and company_id = ?").run(id, companyId);
      this.db.prepare("update workspaces set project_id = null where project_id = ? and company_id = ?").run(id, companyId);
      this.db.prepare("delete from projects where id = ? and company_id = ?").run(id, companyId);
    });
  }

  deleteWorkspace(id: string, companyId: string) {
    this.transaction(() => {
      this.db.prepare("update agents set workspace_id = null where workspace_id = ? and company_id = ?").run(id, companyId);
      this.db.prepare("update tasks set workspace_id = null where workspace_id = ? and company_id = ?").run(id, companyId);
      this.db.prepare("delete from workspaces where id = ? and company_id = ?").run(id, companyId);
    });
  }

  deleteApproval(id: string, companyId: string) {
    this.db.prepare("delete from approvals where id = ? and company_id = ?").run(id, companyId);
  }

  deleteSecret(id: string, companyId: string) {
    this.db.prepare("delete from secrets where id = ? and company_id = ?").run(id, companyId);
  }

  saveSocialAccount(input: {
    id?: string | null;
    companyId: string;
    platform: string;
    accountName: string;
    displayName?: string;
    profileUrl?: string;
    credentialSecretId?: string | null;
    status?: string;
    requireApproval?: boolean;
    metadataJson?: string;
  }): string {
    const id = ensureId(input.id);
    const now = nowIso();
    this.db.prepare(`INSERT INTO social_accounts (id, company_id, platform, account_name, display_name, profile_url, credential_secret_id, status, require_approval, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        platform = excluded.platform,
        account_name = excluded.account_name,
        display_name = excluded.display_name,
        profile_url = excluded.profile_url,
        credential_secret_id = excluded.credential_secret_id,
        status = excluded.status,
        require_approval = excluded.require_approval,
        metadata_json = excluded.metadata_json,
        updated_at = excluded.updated_at`).run(
      id, input.companyId, input.platform, input.accountName,
      input.displayName ?? "", input.profileUrl ?? "",
      input.credentialSecretId ?? null, input.status ?? "login_required",
      input.requireApproval !== false ? 1 : 0,
      input.metadataJson ?? "{}", now, now,
    );
    return id;
  }

  deleteSocialAccount(id: string, companyId: string) {
    this.transaction(() => {
      this.db.prepare("DELETE FROM social_accounts WHERE id = ? AND company_id = ?").run(id, companyId);
      this.db.prepare("DELETE FROM browser_actions WHERE social_account_id = ? AND company_id = ?").run(id, companyId);
    });
  }

  listSocialAccounts(companyId: string): SocialAccountRecord[] {
    const rows = this.db.prepare("SELECT * FROM social_accounts WHERE company_id = ? ORDER BY created_at DESC").all(companyId) as SqliteRow[];
    return rows.map((r) => ({
      id: r.id,
      companyId: r.company_id,
      platform: r.platform,
      accountName: r.account_name,
      displayName: r.display_name,
      profileUrl: r.profile_url,
      credentialSecretId: r.credential_secret_id,
      status: r.status,
      requireApproval: toBoolean(r.require_approval),
      metadataJson: r.metadata_json,
      lastUsedAt: r.last_used_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  saveBrowserAction(input: {
    companyId: string;
    socialAccountId: string;
    agentId: string;
    taskId?: string | null;
    actionType: string;
    payloadJson: string;
    status?: string;
    approvalId?: string | null;
  }): string {
    const id = randomUUID();
    const now = nowIso();
    this.db.prepare(`INSERT INTO browser_actions (id, company_id, social_account_id, agent_id, task_id, action_type, payload_json, status, approval_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, input.companyId, input.socialAccountId, input.agentId,
      input.taskId ?? null, input.actionType, input.payloadJson,
      input.status ?? "queued", input.approvalId ?? null, now, now,
    );
    return id;
  }

  updateBrowserAction(id: string, updates: { status?: string; resultSummary?: string; screenshotPath?: string | null; errorMessage?: string | null; startedAt?: string; finishedAt?: string }) {
    const now = nowIso();
    const sets: string[] = ["updated_at = ?"];
    const values: SQLInputValue[] = [now];
    if (updates.status) { sets.push("status = ?"); values.push(updates.status); }
    if (updates.resultSummary !== undefined) { sets.push("result_summary = ?"); values.push(updates.resultSummary); }
    if (updates.screenshotPath !== undefined) { sets.push("screenshot_path = ?"); values.push(updates.screenshotPath); }
    if (updates.errorMessage !== undefined) { sets.push("error_message = ?"); values.push(updates.errorMessage); }
    if (updates.startedAt) { sets.push("started_at = ?"); values.push(updates.startedAt); }
    if (updates.finishedAt) { sets.push("finished_at = ?"); values.push(updates.finishedAt); }
    values.push(id);
    this.db.prepare(`UPDATE browser_actions SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  }

  listBrowserActions(companyId: string, filters?: { socialAccountId?: string; status?: string; limit?: number }): BrowserActionRecord[] {
    let sql = "SELECT * FROM browser_actions WHERE company_id = ?";
    const params: SQLInputValue[] = [companyId];
    if (filters?.socialAccountId) { sql += " AND social_account_id = ?"; params.push(filters.socialAccountId); }
    if (filters?.status) {
      const statuses = filters.status.split(",").filter(Boolean);
      if (statuses.length > 0) {
        sql += ` AND status IN (${statuses.map(() => "?").join(",")})`;
        params.push(...statuses);
      }
    }
    sql += " ORDER BY created_at DESC";
    if (filters?.limit) { sql += " LIMIT ?"; params.push(filters.limit); }

    const rows = this.db.prepare(sql).all(...params) as SqliteRow[];
    return rows.map((r) => ({
      id: r.id,
      companyId: r.company_id,
      socialAccountId: r.social_account_id,
      agentId: r.agent_id,
      taskId: r.task_id,
      status: r.status,
      actionType: r.action_type,
      payloadJson: r.payload_json,
      resultSummary: r.result_summary,
      screenshotPath: r.screenshot_path,
      approvalId: r.approval_id,
      errorMessage: r.error_message,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  getBrowserAction(id: string, companyId: string): BrowserActionRecord | null {
    const row = this.db
      .prepare("SELECT * FROM browser_actions WHERE id = ? AND company_id = ?")
      .get(id, companyId) as SqliteRow | undefined;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      companyId: row.company_id,
      socialAccountId: row.social_account_id,
      agentId: row.agent_id,
      taskId: row.task_id,
      status: row.status,
      actionType: row.action_type,
      payloadJson: row.payload_json,
      resultSummary: row.result_summary,
      screenshotPath: row.screenshot_path,
      approvalId: row.approval_id,
      errorMessage: row.error_message,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getBrowserActionByApprovalId(approvalId: string, companyId: string): BrowserActionRecord | null {
    const row = this.db
      .prepare("SELECT * FROM browser_actions WHERE approval_id = ? AND company_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(approvalId, companyId) as SqliteRow | undefined;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      companyId: row.company_id,
      socialAccountId: row.social_account_id,
      agentId: row.agent_id,
      taskId: row.task_id,
      status: row.status,
      actionType: row.action_type,
      payloadJson: row.payload_json,
      resultSummary: row.result_summary,
      screenshotPath: row.screenshot_path,
      approvalId: row.approval_id,
      errorMessage: row.error_message,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getSocialAccount(id: string, companyId: string): SocialAccountRecord | null {
    const row = this.db
      .prepare("SELECT * FROM social_accounts WHERE id = ? AND company_id = ?")
      .get(id, companyId) as SqliteRow | undefined;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      companyId: row.company_id,
      platform: row.platform,
      accountName: row.account_name,
      displayName: row.display_name,
      profileUrl: row.profile_url,
      credentialSecretId: row.credential_secret_id,
      status: row.status,
      requireApproval: toBoolean(row.require_approval),
      metadataJson: row.metadata_json,
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  getSidebarBadges(companyId: string): { pendingApprovals: number; activeRuns: number; failedRuns: number; todoTasks: number; budgetWarnings: number; unreadMessages: number } {
    const pendingApprovals = (this.db.prepare("select count(*) as c from approvals where company_id = ? and state = 'pending'").get(companyId) as { c: number })?.c ?? 0;
    const activeRuns = (this.db.prepare("select count(*) as c from runs where company_id = ? and status in ('queued', 'running')").get(companyId) as { c: number })?.c ?? 0;
    const failedRuns = (this.db.prepare("select count(*) as c from runs where company_id = ? and status in ('failed', 'timed_out', 'interrupted')").get(companyId) as { c: number })?.c ?? 0;
    const todoTasks = (this.db.prepare("select count(*) as c from tasks where company_id = ? and status in ('todo', 'in_progress', 'in_review')").get(companyId) as { c: number })?.c ?? 0;
    const budgetWarnings = (this.db.prepare("select count(*) as c from agents where company_id = ? and budget_monthly_usd > 0 and (spent_monthly_usd * 1.0 / budget_monthly_usd) >= 0.8").get(companyId) as { c: number })?.c ?? 0;
    const unreadMessages = (
      this.db.prepare(
        `select count(*) as c
           from agent_messages messages
           left join agent_message_reads reads
             on reads.message_id = messages.id
            and reads.agent_id = ?
          where messages.company_id = ?
            and reads.read_at is null
            and (messages.channel = 'company' or messages.channel = 'incident' or messages.priority = 'urgent')`,
      ).get(BOARD_READER_ID, companyId) as { c: number }
    )?.c ?? 0;
    return { pendingApprovals, activeRuns, failedRuns, todoTasks, budgetWarnings, unreadMessages };
  }

  addComment(input: { companyId: string; taskId: string; authorAgentId: string | null; authorName: string; body: string }): CommentRecord {
    const taskRow = this.db.prepare("select company_id from tasks where id = ?").get(input.taskId) as { company_id: string } | undefined;
    if (!taskRow) throw new Error("Task not found.");
    if (taskRow.company_id !== input.companyId) throw new Error("Task does not belong to this company.");
    const id = randomUUID();
    const ts = nowIso();
    this.db.prepare(
      "insert into task_comments (id, company_id, task_id, author_agent_id, author_name, body, created_at) values (?, ?, ?, ?, ?, ?, ?)",
    ).run(id, input.companyId, input.taskId, input.authorAgentId, input.authorName, input.body, ts);
    return { id, companyId: input.companyId, taskId: input.taskId, authorAgentId: input.authorAgentId, authorName: input.authorName, body: input.body, createdAt: ts };
  }

  listComments(taskId: string): CommentRecord[] {
    return this.readAll<CommentRecord>(
      "select id, company_id as companyId, task_id as taskId, author_agent_id as authorAgentId, author_name as authorName, body, created_at as createdAt from task_comments where task_id = ? order by created_at asc",
      taskId,
    );
  }

  setHeartbeat(agentId: string, enabled: boolean, intervalSec: number) {
    this.db.prepare(
      "update agents set heartbeat_enabled = ?, heartbeat_interval_sec = ?, updated_at = ? where id = ?",
    ).run(enabled ? 1 : 0, intervalSec, nowIso(), agentId);
  }

  markHeartbeatAt(agentId: string) {
    this.db.prepare("update agents set last_heartbeat_at = ? where id = ?").run(nowIso(), agentId);
  }

  resetMonthlyBudgets(companyId: string) {
    this.db.prepare(
      "update agents set spent_monthly_usd = 0, updated_at = ? where company_id = ? and spent_monthly_usd > 0",
    ).run(nowIso(), companyId);
  }

  getLastBudgetResetMonth(companyId: string): string | null {
    return this.getSetting(`budget_reset_month_${companyId}`);
  }

  setLastBudgetResetMonth(companyId: string, month: string) {
    this.setSetting(`budget_reset_month_${companyId}`, month);
  }

  listHeartbeatEligibleAgents(companyId: string): AgentRecord[] {
    return this.readAll<AgentRecord>(
      "select id, company_id as companyId, name, role, title, department, status, reports_to as reportsTo, connector_id as connectorId, workspace_id as workspaceId, model, capabilities, budget_monthly_usd as budgetMonthlyUsd, spent_monthly_usd as spentMonthlyUsd, metadata_json as metadataJson, heartbeat_enabled as heartbeatEnabled, heartbeat_interval_sec as heartbeatIntervalSec, last_heartbeat_at as lastHeartbeatAt, created_at as createdAt, updated_at as updatedAt from agents where company_id = ? and heartbeat_enabled = 1 and status not in ('terminated', 'paused', 'error', 'pending_approval')",
      companyId,
    ).map((record) => ({ ...record, heartbeatEnabled: toBoolean(record.heartbeatEnabled) })) as AgentRecord[];
  }

  checkoutTask(taskId: string, agentId: string): boolean {
    const result = this.db
      .prepare(
        `update tasks
           set assignee_agent_id = ?, status = 'in_progress', updated_at = ?
         where id = ?
           and status in ('todo', 'backlog')
           and (assignee_agent_id is null or assignee_agent_id = ?)`,
      )
      .run(agentId, nowIso(), taskId, agentId);
    return result.changes > 0;
  }

  listAgentTasks(agentId: string, companyId: string, statuses: string[]): TaskRecord[] {
    const placeholders = statuses.map(() => "?").join(",");
    return this.readAll<TaskRecord>(
      `select id, company_id as companyId, project_id as projectId, goal_id as goalId, parent_id as parentId, title, description, assignee_agent_id as assigneeAgentId, workspace_id as workspaceId, status, priority, active_run_id as activeRunId, session_json as sessionJson, session_display_id as sessionDisplayId, cost_usd as costUsd, created_at as createdAt, updated_at as updatedAt
         from tasks
        where company_id = ? and assignee_agent_id = ? and status in (${placeholders})
        order by
          case status
            when 'in_progress' then 0
            when 'todo' then 1
            when 'blocked' then 2
            when 'backlog' then 3
            else 4
          end asc,
          ${taskPriorityOrderSql("priority")} desc,
          created_at asc`,
      companyId, agentId, ...statuses,
    );
  }

  /**
   * List tasks from an agent's direct reports that are awaiting review (status = in_review).
   * Used to populate the "Tasks Awaiting Your Review" section in the agent prompt.
   */
  listReviewTasksForManager(managerId: string, companyId: string): TaskRecord[] {
    return this.readAll<TaskRecord>(
      `select t.id, t.company_id as companyId, t.project_id as projectId, t.goal_id as goalId,
              t.parent_id as parentId, t.title, t.description,
              t.assignee_agent_id as assigneeAgentId, t.workspace_id as workspaceId,
              t.status, t.priority, t.active_run_id as activeRunId,
              t.session_json as sessionJson, t.session_display_id as sessionDisplayId,
              t.cost_usd as costUsd, t.created_at as createdAt, t.updated_at as updatedAt
       from tasks t
       inner join agents a on t.assignee_agent_id = a.id
       where t.company_id = ? and t.status = 'in_review' and a.reports_to = ?
       order by ${taskPriorityOrderSql("t.priority")} desc, t.created_at asc`,
      companyId, managerId,
    );
  }

  getChainOfCommand(agentId: string): AgentRecord[] {
    const chain: AgentRecord[] = [];
    const visited = new Set<string>();
    let current: AgentRecord | undefined;
    try { current = this.getAgent(agentId); } catch { return chain; }
    while (current?.reportsTo) {
      if (visited.has(current.reportsTo)) {
        break;
      }
      visited.add(current.reportsTo);
      try {
        current = this.getAgent(current.reportsTo);
        chain.push(current);
      } catch { break; }
    }
    return chain;
  }

  getDirectReports(agentId: string, companyId: string): AgentRecord[] {
    return this.readAll<AgentRecord>(
      "select id, company_id as companyId, name, role, title, department, status, reports_to as reportsTo, connector_id as connectorId, workspace_id as workspaceId, model, capabilities, budget_monthly_usd as budgetMonthlyUsd, spent_monthly_usd as spentMonthlyUsd, metadata_json as metadataJson, heartbeat_enabled as heartbeatEnabled, heartbeat_interval_sec as heartbeatIntervalSec, last_heartbeat_at as lastHeartbeatAt, created_at as createdAt, updated_at as updatedAt from agents where company_id = ? and reports_to = ?",
      companyId, agentId,
    ).map((record) => ({ ...record, heartbeatEnabled: toBoolean(record.heartbeatEnabled) })) as AgentRecord[];
  }

  enqueuePendingWake(companyId: string, agentId: string, trigger: string) {
    const existing = this.db
      .prepare("select id from pending_wakes where company_id = ? and agent_id = ? limit 1")
      .get(companyId, agentId) as { id: string } | undefined;
    const ts = nowIso();
    if (existing) {
      this.db
        .prepare("update pending_wakes set trigger_reason = ?, created_at = ? where id = ?")
        .run(trigger, ts, existing.id);
      return;
    }
    this.db
      .prepare(
        "insert into pending_wakes (id, company_id, agent_id, trigger_reason, created_at) values (?, ?, ?, ?, ?)",
      )
      .run(randomUUID(), companyId, agentId, trigger, ts);
  }

  consumePendingWakes(agentId: string): Array<{ id: string; companyId: string; trigger: string }> {
    let rows: Array<{ id: string; companyId: string; trigger: string }> = [];
    this.transaction(() => {
      rows = this.readAll<{ id: string; companyId: string; trigger: string }>(
        "select id, company_id as companyId, trigger_reason as trigger from pending_wakes where agent_id = ? order by created_at asc",
        agentId,
      );
      if (rows.length > 0) {
        this.db.prepare("delete from pending_wakes where agent_id = ?").run(agentId);
      }
    });
    return rows;
  }

  exportBackup(targetDir: string) {
    mkdirSync(targetDir, { recursive: true });
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    const copyJobs = [
      backupDatabase(this.db, join(targetDir, "profile.sqlite")),
      cp(this.logsDir, join(targetDir, "logs"), { recursive: true, force: true }),
      cp(this.artifactsDir, join(targetDir, "artifacts"), { recursive: true, force: true }),
      copyIfExists(join(this.profileDir, "vault.key"), join(targetDir, "vault.key")),
      copyIfExists(join(this.profileDir, "agent-api-signing.key"), join(targetDir, "agent-api-signing.key")),
      copyIfExists(`${this.dbPath}-wal`, join(targetDir, "profile.sqlite-wal")),
      copyIfExists(`${this.dbPath}-shm`, join(targetDir, "profile.sqlite-shm")),
    ];
    return Promise.all(copyJobs);
  }

  async restoreFromBackup(sourceDir: string) {
    const sourceDbPath = join(sourceDir, "profile.sqlite");
    if (!existsSync(sourceDbPath)) {
      throw new Error("Backup directory is missing profile.sqlite.");
    }

    this.validateBackupDirectory(sourceDir);
    const recoveryDir = join(this.backupsDir, `pre-restore-${Date.now()}`);
    await this.exportBackup(recoveryDir);

    this.close();
    try {
      await this.applyBackup(sourceDir);
    } catch (error) {
      await this.applyBackup(recoveryDir);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Restore failed. Previous profile was recovered from ${recoveryDir}. ${message}`);
    }
  }

  private readConnectors(): ConnectorRecord[] {
    const rows = this.readAll<{
      id: string;
      label: string;
      description: string;
      status: ConnectorRecord["status"];
      command: string;
      version: string | null;
      auth_state: ConnectorRecord["authState"];
      last_checked_at: string | null;
      last_error: string | null;
      model: string | null;
      env_binding_text: string;
      notes: string;
    }>(
      "select id, label, description, status, command, version, auth_state, last_checked_at, last_error, model, env_binding_text, notes from connectors order by label asc",
    );
    const result: ConnectorRecord[] = [];
    for (const row of rows) {
      let definition;
      try {
        definition = getConnectorDefinition(row.id as ConnectorId);
      } catch {
        // Connector was removed (e.g. kimi_local, opencode_local) — skip it.
        continue;
      }
      result.push({
        id: row.id as ConnectorId,
        label: row.label,
        description: row.description,
        status: row.status,
        command: row.command,
        version: row.version,
        authState: row.auth_state,
        lastCheckedAt: row.last_checked_at,
        lastError: row.last_error,
        model: row.model,
        envBindingText: row.env_binding_text,
        notes: row.notes,
        configurationDoc: definition.configurationDoc,
        capabilityMatrix: definition.capabilityMatrix,
      });
    }
    return result;
  }

  private seedConnectors() {
    // Remove connector rows for adapters that have been removed from the codebase.
    this.db.prepare("delete from connectors where id not in ('codex_local', 'claude_local', 'gemini_local')").run();
    const currentRows = this.readAll<Partial<ConnectorRecord>>(
      "select id, label, description, status, command, version, auth_state as authState, last_checked_at as lastCheckedAt, last_error as lastError, model, env_binding_text as envBindingText, notes from connectors",
    );
    const merged = buildDefaultConnectorRows(currentRows);
    const statement = this.db.prepare(
      "insert or replace into connectors (id, label, description, status, command, version, auth_state, last_checked_at, last_error, model, env_binding_text, notes, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const updatedAt = nowIso();
    for (const row of merged) {
      statement.run(
        row.id,
        row.label,
        row.description,
        row.status,
        row.command,
        row.version,
        row.authState,
        row.lastCheckedAt,
        row.lastError,
        row.model,
        row.envBindingText,
        row.notes,
        updatedAt,
      );
    }
  }

  private seedSettings() {
    if (!this.getSetting("theme")) {
      this.setSetting("theme", "system");
    }
    if (!this.getSetting("updates_enabled")) {
      this.setSetting("updates_enabled", "false");
    }
    if (!this.getSetting("log_retention_days")) {
      this.setSetting("log_retention_days", "90");
    }
  }

  purgeExpiredPendingWakes() {
    // Remove pending wakes older than 2 hours — if agent hasn't woken by then, the wake is stale
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const result = this.db.prepare("delete from pending_wakes where created_at < ?").run(cutoff);
    return Number(result.changes);
  }

  private _lastInterruptedCount = 0;

  get lastInterruptedCount(): number {
    return this._lastInterruptedCount;
  }

  interruptStaleRuns(): number {
    const ts = nowIso();
    let interruptedCount = 0;
    this.transaction(() => {
      const result = this.db
        .prepare(
          "update runs set status = 'interrupted', error_message = 'AgentCompany restarted before the run could report completion.', finished_at = ?, updated_at = ? where status = 'running'",
        )
        .run(ts, ts);
      interruptedCount = Number(result.changes);

      if (interruptedCount > 0) {
        // Mark associated tasks as blocked to prevent heartbeat re-queuing
        this.db.prepare(
          `update tasks set status = 'blocked', updated_at = ? where id in (
            select task_id from runs where status = 'interrupted' and finished_at = ?
          ) and status in ('in_progress', 'todo')`
        ).run(ts, ts);
      }

      this.db.prepare("update tasks set active_run_id = null where active_run_id in (select id from runs where status = 'interrupted')").run();
      // Reset any agents stuck in "running" status back to "idle"
      this.db
        .prepare("update agents set status = 'idle', updated_at = ? where status = 'running'")
        .run(ts);
      this.releaseAllWorkspaceLocks();
    });
    return interruptedCount;
  }

  getCompanyStatus(companyId: string): string | null {
    const row = this.db.prepare("select status from companies where id = ?").get(companyId) as { status: string } | undefined;
    return row?.status ?? null;
  }

  getCompanyBasic(companyId: string): { name: string; description: string } | null {
    const row = this.db.prepare("select name, description from companies where id = ?").get(companyId) as { name: string; description: string } | undefined;
    return row ?? null;
  }

  listActiveCompanyIds(): Array<{ id: string; name: string }> {
    return this.readAll<{ id: string; name: string }>(
      "select id, name from companies where status = 'active'",
    );
  }

  countActiveTasksForCompany(companyId: string): number {
    const row = this.db.prepare(
      "select count(*) as cnt from tasks where company_id = ? and status not in ('done', 'cancelled') and title not like '[Heartbeat]%'",
    ).get(companyId) as { cnt: number };
    return row.cnt;
  }

  countActiveGoalsForCompany(companyId: string): number {
    const row = this.db.prepare(
      "select count(*) as cnt from goals where company_id = ? and status in ('active', 'planned')",
    ).get(companyId) as { cnt: number };
    return row.cnt;
  }

  getCeoForCompany(companyId: string): { id: string; name: string; lastHeartbeatAt: string | null } | null {
    const row = this.db.prepare(
      "select id, name, last_heartbeat_at as lastHeartbeatAt from agents where company_id = ? and reports_to is null and status != 'terminated' limit 1",
    ).get(companyId) as { id: string; name: string; lastHeartbeatAt: string | null } | undefined;
    return row ?? null;
  }

  listActiveAgentsForCompany(companyId: string): Array<{ id: string; name: string; department: string | null; lastHeartbeatAt: string | null }> {
    return this.readAll<{ id: string; name: string; department: string | null; lastHeartbeatAt: string | null }>(
      "select id, name, department, last_heartbeat_at as lastHeartbeatAt from agents where company_id = ? and status not in ('terminated', 'paused', 'pending_approval')",
      companyId,
    );
  }

  hasAgentAssignedTasks(agentId: string, companyId: string): boolean {
    const row = this.db.prepare(
      "select 1 from tasks where assignee_agent_id = ? and company_id = ? and status in ('todo', 'in_progress', 'blocked') limit 1",
    ).get(agentId, companyId);
    return !!row;
  }

  listChildTasks(parentId: string, companyId: string): Array<{ id: string; status: string; assigneeAgentId: string | null }> {
    return this.readAll<{ id: string; status: string; assigneeAgentId: string | null }>(
      `select id, status, assignee_agent_id as assigneeAgentId from tasks where parent_id = ? and company_id = ?`,
      parentId, companyId,
    );
  }

  updateAgentStatus(agentId: string, status: string) {
    const ts = new Date().toISOString();
    this.db.prepare("update agents set status = ?, updated_at = ? where id = ?").run(status, ts, agentId);
  }

  private getSetting(key: string): string | null {
    const row = this.db.prepare("select value from settings where key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private setSetting(key: string, value: string) {
    this.db
      .prepare("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value")
      .run(key, value);
  }

  private readAll<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  /** Public read-only query method for cross-service deliverable checks. */
  queryAll<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.readAll<T>(sql, ...params);
  }

  private wouldCreateAgentCycle(agentId: string, reportsTo: string | null) {
    if (!reportsTo) return false;
    if (reportsTo === agentId) return true;

    const visited = new Set<string>([agentId]);
    let currentId: string | null = reportsTo;
    while (currentId) {
      if (visited.has(currentId)) {
        return true;
      }
      visited.add(currentId);
      const current = this.db
        .prepare("select reports_to as reportsTo from agents where id = ?")
        .get(currentId) as { reportsTo: string | null } | undefined;
      currentId = current?.reportsTo ?? null;
    }
    return false;
  }

  private ensureOptionalColumns() {
    const addColumnIfMissing = (sql: string) => {
      try { this.db.prepare(sql).run(); } catch { /* column already exists */ }
    };

    addColumnIfMissing("alter table connectors add column updated_at text");
    addColumnIfMissing("alter table approvals add column payload_json text");
    addColumnIfMissing("alter table agents add column heartbeat_enabled integer not null default 0");
    addColumnIfMissing("alter table agents add column heartbeat_interval_sec integer not null default 120");
    addColumnIfMissing("alter table agents add column last_heartbeat_at text");
    addColumnIfMissing("alter table companies add column auto_approve_hires integer not null default 0");
    addColumnIfMissing("alter table companies add column review_deliverables integer not null default 0");
    addColumnIfMissing("alter table tasks add column task_type text not null default 'general'");
    addColumnIfMissing("alter table tasks add column requires_user_review integer not null default 0");
    addColumnIfMissing("alter table tasks add column retry_count integer not null default 0");
    addColumnIfMissing("alter table tasks add column last_failure_at text");
    this.db.exec(`
      create table if not exists task_comments (
        id text primary key,
        company_id text not null,
        task_id text not null,
        author_agent_id text,
        author_name text not null,
        body text not null,
        created_at text not null
      );
      create index if not exists idx_comments_task on task_comments(task_id);
      create index if not exists idx_comments_company on task_comments(company_id);
    `);

    this.db.exec(`
      create table if not exists social_accounts (
        id text primary key,
        company_id text not null references companies(id) on delete cascade,
        platform text not null default 'other',
        account_name text not null,
        display_name text not null default '',
        profile_url text not null default '',
        credential_secret_id text,
        status text not null default 'login_required',
        require_approval integer not null default 1,
        metadata_json text not null default '{}',
        last_used_at text,
        created_at text not null default (datetime('now')),
        updated_at text not null default (datetime('now'))
      );
      create index if not exists idx_social_accounts_company on social_accounts(company_id);
    `);

    this.db.exec(`
      create table if not exists browser_actions (
        id text primary key,
        company_id text not null references companies(id) on delete cascade,
        social_account_id text not null references social_accounts(id) on delete cascade,
        agent_id text not null references agents(id) on delete cascade,
        task_id text,
        action_type text not null default 'custom_script',
        payload_json text not null default '{}',
        status text not null default 'queued',
        result_summary text not null default '',
        screenshot_path text,
        approval_id text,
        error_message text,
        started_at text,
        finished_at text,
        created_at text not null default (datetime('now')),
        updated_at text not null default (datetime('now'))
      );
      create index if not exists idx_browser_actions_company on browser_actions(company_id);
      create index if not exists idx_browser_actions_account on browser_actions(social_account_id);
    `);

    // Add composite indexes for tables created in migrations (safe: uses IF NOT EXISTS)
    try {
      this.db.exec(`
        create index if not exists idx_messages_company on agent_messages(company_id);
        create index if not exists idx_messages_channel on agent_messages(channel, channel_target_id);
        create index if not exists idx_automation_rules_company_status on automation_rules(company_id, status);
        create index if not exists idx_automation_log_company on automation_log(company_id);
      `);
    } catch { /* tables may not exist yet - indexes will be created by migrations */ }
  }

  /**
   * Check whether a run can start given pending approvals.
   * Returns null if no blocking approval exists, or the blocking approval record.
   *
   * Uses the structured `related_agent_id` column for hire_agent lookups
   * instead of fragile payload_json LIKE matching.
   */
  getBlockingApproval(companyId: string, agentId: string, taskId: string | null): ApprovalRecord | null {
    const taskCondition = taskId != null
      ? "(related_task_id = ? or requested_by_agent_id = ?)"
      : "requested_by_agent_id = ?";
    const taskParams: SQLInputValue[] = taskId != null ? [taskId, agentId] : [agentId];
    const rows = this.readAll<ApprovalRecord>(
      `select id, company_id as companyId, related_task_id as relatedTaskId,
              requested_by_agent_id as requestedByAgentId, related_agent_id as relatedAgentId,
              type, payload_summary as payloadSummary, impact_summary as impactSummary,
              payload_json as payloadJson, decision_note as decisionNote, state,
              created_at as createdAt, updated_at as updatedAt
       from approvals
       where company_id = ? and state = 'pending'
         and (
           (type = 'hire_agent' and related_agent_id = ?)
           or (type = 'dangerous_command' and ${taskCondition})
           or (type = 'secret_access' and ${taskCondition})
           or (type = 'approve_ceo_strategy' and ${taskCondition})
           or (type = 'deliverable_review' and (requested_by_agent_id = ? or (related_task_id is not null and ${taskCondition})))
         )
       order by created_at asc limit 1`,
      companyId,
      agentId,
      ...taskParams,
      ...taskParams,
      ...taskParams,
      agentId,
      ...taskParams,
    );
    return rows.length > 0 ? rows[0] : null;
  }

  isAgentPendingApproval(agentId: string): boolean {
    const row = this.db
      .prepare("select status from agents where id = ?")
      .get(agentId) as { status: string } | undefined;
    return row?.status === "pending_approval";
  }

  /**
   * Acquire a workspace write lock for a run. Returns true if acquired.
   * If another run already holds the lock, returns false.
   */
  acquireWorkspaceLock(workspaceId: string, runId: string): boolean {
    const ts = nowIso();
    const result = this.db
      .prepare(
        `update workspaces
           set lock_holder_run_id = ?, lock_acquired_at = ?, state = 'busy', updated_at = ?
         where id = ?
           and (lock_holder_run_id is null or lock_holder_run_id = ?)`,
      )
      .run(runId, ts, ts, workspaceId, runId);
    return result.changes > 0;
  }

  claimWorkspaceLock(workspaceId: string, runId: string): boolean {
    const holder = this.db
      .prepare("select lock_holder_run_id as lockHolderRunId from workspaces where id = ?")
      .get(workspaceId) as { lockHolderRunId: string | null } | undefined;
    if (!holder) return false;
    if (!holder.lockHolderRunId || holder.lockHolderRunId === runId) {
      return this.acquireWorkspaceLock(workspaceId, runId);
    }
    const blockingRun = this.db
      .prepare("select status from runs where id = ?")
      .get(holder.lockHolderRunId) as { status: RunStatus } | undefined;
    if (blockingRun && (blockingRun.status === "queued" || blockingRun.status === "running")) {
      return false;
    }
    const ts = nowIso();
    const result = this.db
      .prepare(
        `update workspaces
           set lock_holder_run_id = ?, lock_acquired_at = ?, state = 'busy', updated_at = ?
         where id = ? and lock_holder_run_id = ?`,
      )
      .run(runId, ts, ts, workspaceId, holder.lockHolderRunId);
    return result.changes > 0;
  }

  releaseWorkspaceLock(workspaceId: string, runId: string) {
    this.db
      .prepare(
        `update workspaces
           set lock_holder_run_id = null, lock_acquired_at = null, state = 'ready', updated_at = ?
         where id = ? and lock_holder_run_id = ?`,
      )
      .run(nowIso(), workspaceId, runId);
  }

  /**
   * Force-release all workspace locks (used during crash recovery on startup).
   */
  releaseAllWorkspaceLocks() {
    this.db
      .prepare(
        "update workspaces set lock_holder_run_id = null, lock_acquired_at = null, state = 'ready', updated_at = ? where lock_holder_run_id is not null",
      )
      .run(nowIso());
  }

  releaseStaleWorkspaceLocks(): number {
    const result = this.db
      .prepare(
        `update workspaces
            set lock_holder_run_id = null, lock_acquired_at = null, state = 'ready', updated_at = ?
          where lock_holder_run_id is not null
            and not exists (
              select 1
                from runs
               where runs.id = workspaces.lock_holder_run_id
                 and runs.status in ('queued', 'running')
            )`,
      )
      .run(nowIso());
    return Number(result.changes);
  }

  listQueuedRuns() {
    return this.readAll<RunRecord>(
      `select id, company_id as companyId, task_id as taskId, agent_id as agentId, workspace_id as workspaceId,
              connector_id as connectorId, status, summary, error_message as errorMessage, exit_code as exitCode,
              signal, model, session_display_id as sessionDisplayId, cost_usd as costUsd,
              unattributed_cost as unattributedCost, started_at as startedAt, finished_at as finishedAt,
              log_path as logPath, created_at as createdAt, updated_at as updatedAt
         from runs
        where status = 'queued'
        order by created_at asc`,
    ).map((record) => ({ ...record, unattributedCost: toBoolean(record.unattributedCost) })) as RunRecord[];
  }

  isWorkspaceLocked(workspaceId: string): boolean {
    const row = this.db
      .prepare("select lock_holder_run_id from workspaces where id = ?")
      .get(workspaceId) as { lock_holder_run_id: string | null } | undefined;
    return Boolean(row?.lock_holder_run_id);
  }

  saveMeeting(input: {
    id?: string | null; companyId: string; type: string; title: string; organizerAgentId?: string | null;
    participantAgentIds?: string; scheduledAt: string; durationMinutes?: number;
    agendaJson?: string; notesJson?: string; decisionsJson?: string; actionItemsJson?: string;
    status?: string;
  }) {
    const id = ensureId(input.id ?? null);
    const ts = nowIso();
    const existing = this.db.prepare("select id from meetings where id = ?").get(id) as { id: string } | undefined;
    if (existing) {
      this.db.prepare(
        "update meetings set type = ?, title = ?, organizer_agent_id = ?, participant_agent_ids = ?, scheduled_at = ?, duration_minutes = ?, agenda_json = ?, notes_json = ?, decisions_json = ?, action_items_json = ?, status = ?, updated_at = ? where id = ?",
      ).run(input.type, input.title, input.organizerAgentId ?? null, input.participantAgentIds ?? "[]", input.scheduledAt, input.durationMinutes ?? 30, input.agendaJson ?? "[]", input.notesJson ?? "[]", input.decisionsJson ?? "[]", input.actionItemsJson ?? "[]", input.status ?? "scheduled", ts, id);
    } else {
      this.db.prepare(
        "insert into meetings (id, company_id, type, title, organizer_agent_id, participant_agent_ids, scheduled_at, duration_minutes, agenda_json, notes_json, decisions_json, action_items_json, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(id, input.companyId, input.type, input.title, input.organizerAgentId ?? null, input.participantAgentIds ?? "[]", input.scheduledAt, input.durationMinutes ?? 30, input.agendaJson ?? "[]", input.notesJson ?? "[]", input.decisionsJson ?? "[]", input.actionItemsJson ?? "[]", input.status ?? "scheduled", ts, ts);
    }
    return id;
  }

  deleteMeeting(id: string, companyId: string) {
    this.db.prepare("delete from meetings where id = ? and company_id = ?").run(id, companyId);
  }

  saveDocument(input: {
    id?: string | null; companyId: string; type: string; title: string; content?: string;
    authorAgentId?: string | null; reviewerAgentId?: string | null; projectId?: string | null;
    goalId?: string | null; parentDocId?: string | null; version?: number; status?: string; tagsJson?: string;
  }) {
    const id = ensureId(input.id ?? null);
    const ts = nowIso();
    const existing = this.db.prepare("select id from documents where id = ?").get(id) as { id: string } | undefined;
    if (existing) {
      this.db.prepare(
        "update documents set type = ?, title = ?, content = ?, author_agent_id = ?, reviewer_agent_id = ?, project_id = ?, goal_id = ?, parent_doc_id = ?, version = ?, status = ?, tags_json = ?, updated_at = ? where id = ?",
      ).run(input.type, input.title, input.content ?? "", input.authorAgentId ?? null, input.reviewerAgentId ?? null, input.projectId ?? null, input.goalId ?? null, input.parentDocId ?? null, input.version ?? 1, input.status ?? "draft", input.tagsJson ?? "[]", ts, id);
    } else {
      this.db.prepare(
        "insert into documents (id, company_id, type, title, content, author_agent_id, reviewer_agent_id, project_id, goal_id, parent_doc_id, version, status, tags_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(id, input.companyId, input.type, input.title, input.content ?? "", input.authorAgentId ?? null, input.reviewerAgentId ?? null, input.projectId ?? null, input.goalId ?? null, input.parentDocId ?? null, input.version ?? 1, input.status ?? "draft", input.tagsJson ?? "[]", ts, ts);
    }
    return id;
  }

  deleteDocument(id: string, companyId: string) {
    this.db.prepare("delete from documents where id = ? and company_id = ?").run(id, companyId);
  }

  saveKnowledgeEntry(input: {
    id?: string | null; companyId: string; category: string; topic: string; content: string;
    authorAgentId?: string | null; importance?: string; tagsJson?: string;
    referencedEntityType?: string | null; referencedEntityId?: string | null;
  }) {
    const id = ensureId(input.id ?? null);
    const ts = nowIso();
    const existing = this.db.prepare("select id from knowledge_base where id = ?").get(id) as { id: string } | undefined;
    if (existing) {
      this.db.prepare(
        "update knowledge_base set category = ?, topic = ?, content = ?, author_agent_id = ?, importance = ?, tags_json = ?, referenced_entity_type = ?, referenced_entity_id = ?, updated_at = ? where id = ?",
      ).run(input.category, input.topic, input.content, input.authorAgentId ?? null, input.importance ?? "medium", input.tagsJson ?? "[]", input.referencedEntityType ?? null, input.referencedEntityId ?? null, ts, id);
    } else {
      this.db.prepare(
        "insert into knowledge_base (id, company_id, category, topic, content, author_agent_id, importance, tags_json, referenced_entity_type, referenced_entity_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(id, input.companyId, input.category, input.topic, input.content, input.authorAgentId ?? null, input.importance ?? "medium", input.tagsJson ?? "[]", input.referencedEntityType ?? null, input.referencedEntityId ?? null, ts, ts);
    }
    return id;
  }

  deleteKnowledgeEntry(id: string, companyId: string) {
    this.db.prepare("delete from knowledge_base where id = ? and company_id = ?").run(id, companyId);
  }

  saveSprint(input: {
    id?: string | null; companyId: string; name: string; goal?: string;
    startDate: string; endDate: string; status?: string; retrospectiveNotes?: string;
    velocityPoints?: number; completedPoints?: number;
  }) {
    const id = ensureId(input.id ?? null);
    const ts = nowIso();
    const existing = this.db.prepare("select id from sprints where id = ?").get(id) as { id: string } | undefined;
    if (existing) {
      this.db.prepare(
        "update sprints set name = ?, goal = ?, start_date = ?, end_date = ?, status = ?, retrospective_notes = ?, velocity_points = ?, completed_points = ?, updated_at = ? where id = ?",
      ).run(input.name, input.goal ?? "", input.startDate, input.endDate, input.status ?? "planning", input.retrospectiveNotes ?? "", input.velocityPoints ?? 0, input.completedPoints ?? 0, ts, id);
    } else {
      this.db.prepare(
        "insert into sprints (id, company_id, name, goal, start_date, end_date, status, retrospective_notes, velocity_points, completed_points, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(id, input.companyId, input.name, input.goal ?? "", input.startDate, input.endDate, input.status ?? "planning", input.retrospectiveNotes ?? "", input.velocityPoints ?? 0, input.completedPoints ?? 0, ts, ts);
    }
    return id;
  }

  deleteSprint(id: string, companyId: string) {
    this.db.prepare("delete from sprints where id = ? and company_id = ?").run(id, companyId);
  }

  saveAutomationRule(input: {
    id?: string | null; companyId: string; name: string; description?: string;
    trigger: string; conditionsJson?: string; action: string; actionConfigJson?: string;
    sourceDepartment?: string | null; targetDepartment?: string | null;
    priority?: number; status?: string;
  }) {
    const id = ensureId(input.id ?? null);
    const ts = nowIso();
    const existing = this.db.prepare("select id from automation_rules where id = ?").get(id) as { id: string } | undefined;
    if (existing) {
      this.db.prepare(
        "update automation_rules set name = ?, description = ?, trigger = ?, conditions_json = ?, action = ?, action_config_json = ?, source_department = ?, target_department = ?, priority = ?, status = ?, updated_at = ? where id = ?",
      ).run(input.name, input.description ?? "", input.trigger, input.conditionsJson ?? "{}", input.action, input.actionConfigJson ?? "{}", input.sourceDepartment ?? null, input.targetDepartment ?? null, input.priority ?? 50, input.status ?? "active", ts, id);
    } else {
      this.db.prepare(
        "insert into automation_rules (id, company_id, name, description, trigger, conditions_json, action, action_config_json, source_department, target_department, priority, status, execution_count, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)",
      ).run(id, input.companyId, input.name, input.description ?? "", input.trigger, input.conditionsJson ?? "{}", input.action, input.actionConfigJson ?? "{}", input.sourceDepartment ?? null, input.targetDepartment ?? null, input.priority ?? 50, input.status ?? "active", ts, ts);
    }
    this.addActivity({ companyId: input.companyId, actor: "system", action: existing ? "updated" : "created", entityType: "automation_rule", entityId: id, detail: `${existing ? "Updated" : "Created"} automation rule: ${input.name}` });
    return id;
  }

  deleteAutomationRule(id: string, companyId: string) {
    this.db.prepare("delete from automation_rules where id = ? and company_id = ?").run(id, companyId);
  }

  listAutomationRuleNames(companyId: string): Set<string> {
    return new Set(
      this.readAll<{ name: string }>(
        "select name from automation_rules where company_id = ?",
        companyId,
      ).map((row) => row.name),
    );
  }

  toggleAutomationRule(id: string, companyId: string, status: "active" | "paused") {
    this.db.prepare("update automation_rules set status = ?, updated_at = ? where id = ? and company_id = ?").run(status, nowIso(), id, companyId);
  }

  recordAutomationExecution(ruleId: string, companyId: string, ruleName: string, trigger: string, action: string, detail: string) {
    const id = randomUUID();
    this.db.prepare("insert into automation_log (id, company_id, rule_id, rule_name, trigger, action, detail, executed_at) values (?, ?, ?, ?, ?, ?, ?, ?)").run(id, companyId, ruleId, ruleName, trigger, action, detail, nowIso());
    this.db.prepare("update automation_rules set execution_count = execution_count + 1, last_executed_at = ? where id = ?").run(nowIso(), ruleId);
  }

  getAutomationLog(companyId: string) {
    return this.readAll<{ ruleId: string; ruleName: string; trigger: string; action: string; executedAt: string }>(
      "select rule_id as ruleId, rule_name as ruleName, trigger, action, executed_at as executedAt from automation_log where company_id = ? order by executed_at desc limit 100",
      companyId,
    );
  }

  sendAgentMessage(input: {
    companyId: string; fromAgentId: string; toAgentId?: string | null;
    channel?: string; channelTargetId?: string | null; subject: string; body: string;
    priority?: string; parentMessageId?: string | null; attachmentsJson?: string;
  }) {
    const channel = input.channel ?? "direct";
    if (channel === "direct" && !input.toAgentId) {
      throw new Error("Direct messages require a recipient.");
    }
    const id = randomUUID();
    this.db.prepare(
      "insert into agent_messages (id, company_id, from_agent_id, to_agent_id, channel, channel_target_id, subject, body, priority, parent_message_id, attachments_json, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, input.companyId, input.fromAgentId, input.toAgentId ?? null, channel, input.channelTargetId ?? null, input.subject, input.body, input.priority ?? "normal", input.parentMessageId ?? null, input.attachmentsJson ?? "[]", nowIso());
    this.addActivity({ companyId: input.companyId, actor: input.fromAgentId, action: "sent_message", entityType: "agent_message", entityId: id, detail: `Message: ${input.subject}` });
    return id;
  }

  getAgentMessage(messageId: string, companyId: string): AgentMessageRecord | null {
    const row = this.db.prepare(
      "select id, company_id as companyId, from_agent_id as fromAgentId, to_agent_id as toAgentId, channel, channel_target_id as channelTargetId, subject, body, priority, read_at as readAt, parent_message_id as parentMessageId, attachments_json as attachmentsJson, created_at as createdAt from agent_messages where id = ? and company_id = ?",
    ).get(messageId, companyId) as AgentMessageRecord | undefined;
    return row ?? null;
  }

  listAgentMessages(companyId: string, opts?: {
    agentId?: string;
    messageId?: string;
    channel?: string;
    channelTargetId?: string | null;
    unreadOnly?: boolean;
    limit?: number;
  }) {
    let sql = "select id, company_id as companyId, from_agent_id as fromAgentId, to_agent_id as toAgentId, channel, channel_target_id as channelTargetId, subject, body, priority, read_at as readAt, parent_message_id as parentMessageId, attachments_json as attachmentsJson, created_at as createdAt from agent_messages where company_id = ?";
    const params: SQLInputValue[] = [companyId];
    if (opts?.messageId) {
      sql += " and id = ?";
      params.push(opts.messageId);
    }
    if (opts?.channel) { sql += " and channel = ?"; params.push(opts.channel); }
    if (opts?.channelTargetId !== undefined && opts?.channelTargetId !== null) {
      sql += " and channel_target_id = ?"; params.push(opts.channelTargetId);
    }
    sql += " order by created_at asc";

    let messages = this.readAll<AgentMessageRecord>(sql, ...params);
    if (!opts?.agentId) {
      const boardReadReceiptMap = new Map(
        this.readAll<{ messageId: string; readAt: string }>(
          `select reads.message_id as messageId, reads.read_at as readAt
             from agent_message_reads reads
             join agent_messages messages on messages.id = reads.message_id
            where reads.agent_id = ? and messages.company_id = ?`,
          BOARD_READER_ID,
          companyId,
        ).map((row) => [row.messageId, row.readAt]),
      );
      messages = messages.map((message) => ({
        ...message,
        readAt: boardReadReceiptMap.get(message.id) ?? null,
      }));
    }
    if (opts?.agentId) {
      let department: string | null = null;
      try {
        const agent = this.getAgent(opts.agentId);
        if (agent.companyId === companyId) {
          department = agent.department;
        }
      } catch {
        department = null;
      }

      const relevantProjectIds = new Set<string>();
      for (const row of this.readAll<{ projectId: string | null }>(
        "select distinct project_id as projectId from tasks where company_id = ? and assignee_agent_id = ? and project_id is not null",
        companyId,
        opts.agentId,
      )) {
        if (row.projectId) relevantProjectIds.add(row.projectId);
      }
      for (const row of this.readAll<{ id: string }>(
        "select id from projects where company_id = ? and lead_agent_id = ?",
        companyId,
        opts.agentId,
      )) {
        relevantProjectIds.add(row.id);
      }

      const readReceiptMap = new Map(
        this.readAll<{ messageId: string; readAt: string }>(
          `select reads.message_id as messageId, reads.read_at as readAt
             from agent_message_reads reads
             join agent_messages messages on messages.id = reads.message_id
            where reads.agent_id = ? and messages.company_id = ?`,
          opts.agentId,
          companyId,
        ).map((row) => [row.messageId, row.readAt]),
      );

      messages = messages.filter((message) => {
        if (message.fromAgentId === opts.agentId) {
          return true;
        }
        if (message.channel === "direct") {
          return message.toAgentId === opts.agentId;
        }
        if (message.channel === "company" || message.channel === "incident") {
          return true;
        }
        if (message.channel === "department") {
          return Boolean(department) && message.channelTargetId === department;
        }
        if (message.channel === "project") {
          return Boolean(message.channelTargetId && relevantProjectIds.has(message.channelTargetId));
        }
        return false;
      }).map((message) => {
        if (message.fromAgentId === opts.agentId) {
          return { ...message, readAt: message.createdAt };
        }
        return {
          ...message,
          readAt: readReceiptMap.get(message.id) ?? null,
        };
      });
    }
    if (opts?.unreadOnly) {
      messages = messages.filter((message) => !message.readAt);
    }
    const limit = opts?.limit ?? 200;
    return limit > 0 ? messages.slice(-limit) : messages;
  }

  searchMessages(companyId: string, query: string, opts?: {
    channel?: string;
    channelTargetId?: string | null;
    limit?: number;
  }): AgentMessageRecord[] {
    const escaped = query.replace(/[%_]/g, "\\$&");
    const pattern = `%${escaped}%`;
    let sql = `SELECT id, company_id AS companyId, from_agent_id AS fromAgentId,
      to_agent_id AS toAgentId, channel, channel_target_id AS channelTargetId,
      subject, body, priority, read_at AS readAt, parent_message_id AS parentMessageId,
      attachments_json AS attachmentsJson, created_at AS createdAt
      FROM agent_messages WHERE company_id = ? AND (subject LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')`;
    const params: SQLInputValue[] = [companyId, pattern, pattern];
    if (opts?.channel) { sql += " AND channel = ?"; params.push(opts.channel); }
    if (opts?.channelTargetId !== undefined && opts?.channelTargetId !== null) { sql += " AND channel_target_id = ?"; params.push(opts.channelTargetId); }
    sql += " ORDER BY created_at DESC LIMIT ?";
    params.push(opts?.limit ?? 50);
    return this.readAll<AgentMessageRecord>(sql, ...params);
  }

  markMessageRead(messageId: string, companyId: string) {
    this.markAgentMessageRead(messageId, companyId, BOARD_READER_ID);
  }

  markMessageReadForReader(messageId: string, companyId: string, readerAgentId?: string | null) {
    this.markAgentMessageRead(messageId, companyId, readerAgentId ?? BOARD_READER_ID);
  }

  markAgentMessageRead(messageId: string, companyId: string, agentId: string) {
    const ts = nowIso();
    this.db.prepare(
      `insert into agent_message_reads (message_id, agent_id, read_at)
       select id, ?, ?
         from agent_messages
        where id = ? and company_id = ?
       on conflict(message_id, agent_id) do update set read_at = excluded.read_at`,
    ).run(agentId, ts, messageId, companyId);
  }

  saveWorkflow(input: {
    id?: string | null; companyId: string; name: string; description?: string;
    stepsJson?: string; triggerType: string; triggerConfigJson?: string; status?: string;
  }) {
    const id = ensureId(input.id ?? null);
    const ts = nowIso();
    const existing = this.db.prepare("select id from workflow_pipelines where id = ?").get(id) as { id: string } | undefined;
    if (existing) {
      this.db.prepare(
        "update workflow_pipelines set name = ?, description = ?, steps_json = ?, trigger_type = ?, trigger_config_json = ?, status = ?, updated_at = ? where id = ?",
      ).run(input.name, input.description ?? "", input.stepsJson ?? "[]", input.triggerType, input.triggerConfigJson ?? "{}", input.status ?? "draft", ts, id);
    } else {
      this.db.prepare(
        "insert into workflow_pipelines (id, company_id, name, description, steps_json, trigger_type, trigger_config_json, status, current_step_index, run_count, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)",
      ).run(id, input.companyId, input.name, input.description ?? "", input.stepsJson ?? "[]", input.triggerType, input.triggerConfigJson ?? "{}", input.status ?? "draft", ts, ts);
    }
    this.addActivity({ companyId: input.companyId, actor: "system", action: existing ? "updated" : "created", entityType: "workflow", entityId: id, detail: `${existing ? "Updated" : "Created"} workflow: ${input.name}` });
    return id;
  }

  getWorkflowRecord(id: string, companyId: string): WorkflowPipelineRecord | null {
    const row = this.db.prepare(
      "select id, company_id as companyId, name, description, steps_json as stepsJson, trigger_type as triggerType, trigger_config_json as triggerConfigJson, status, current_step_index as currentStepIndex, run_count as runCount, last_run_at as lastRunAt, created_at as createdAt, updated_at as updatedAt from workflow_pipelines where id = ? and company_id = ?",
    ).get(id, companyId) as WorkflowPipelineRecord | undefined;
    return row ?? null;
  }

  updateWorkflowExecution(input: {
    id: string;
    companyId: string;
    status: string;
    currentStepIndex: number;
    stepsJson: string;
    incrementRunCount?: boolean;
    lastRunAt?: string | null;
  }) {
    const ts = nowIso();
    const runCountClause = input.incrementRunCount ? ", run_count = run_count + 1" : "";
    const lastRunAt = input.lastRunAt ?? null;
    this.db.prepare(
      `update workflow_pipelines
         set status = ?, current_step_index = ?, steps_json = ?, last_run_at = ?, updated_at = ?${runCountClause}
       where id = ? and company_id = ?`,
    ).run(input.status, input.currentStepIndex, input.stepsJson, lastRunAt, ts, input.id, input.companyId);
  }

  deleteWorkflow(id: string, companyId: string) {
    this.db.prepare("delete from workflow_pipelines where id = ? and company_id = ?").run(id, companyId);
  }

  listActiveAutomationRules(companyId: string, trigger: string): Array<{
    id: string; name: string; trigger: string; conditionsJson: string;
    action: string; actionConfigJson: string; sourceDepartment: string | null;
    targetDepartment: string | null; priority: number;
  }> {
    return this.readAll(
      "select id, name, trigger, conditions_json as conditionsJson, action, action_config_json as actionConfigJson, source_department as sourceDepartment, target_department as targetDepartment, priority from automation_rules where company_id = ? and trigger = ? and status = 'active' order by priority desc",
      companyId, trigger,
    );
  }

  advanceTaskStatus(taskId: string, newStatus: string, comment?: string): { previousStatus: string } {
    const task = this.db.prepare("select status, company_id from tasks where id = ?").get(taskId) as { status: string; company_id: string } | undefined;
    if (!task) throw new Error(`Task not found: ${taskId}`);
    const previousStatus = task.status;
    if (previousStatus === newStatus) return { previousStatus };
    const ts = nowIso();
    this.db.prepare("update tasks set status = ?, updated_at = ? where id = ?").run(newStatus, ts, taskId);
    if (comment) {
      this.addComment({
        companyId: task.company_id,
        taskId,
        authorAgentId: null,
        authorName: "System",
        body: comment,
      });
    }
    // Track sprint velocity: increment completed_points when task moves to "done"
    if (newStatus === "done" && previousStatus !== "done") {
      this.incrementActiveSprintVelocity(task.company_id, 1);
    }
    // Decrement if task moves back from done
    if (previousStatus === "done" && newStatus !== "done") {
      this.incrementActiveSprintVelocity(task.company_id, -1);
    }
    return { previousStatus };
  }

  setTaskRequiresUserReview(taskId: string, value: boolean) {
    const ts = nowIso();
    this.db.prepare("update tasks set requires_user_review = ?, updated_at = ? where id = ?").run(value ? 1 : 0, ts, taskId);
  }

  /** Returns true if the company has any pending deliverable_review approvals or tasks awaiting review. */
  hasPendingDeliverableReviews(companyId: string): boolean {
    const approval = this.db.prepare(
      "select 1 from approvals where company_id = ? and type = 'deliverable_review' and state = 'pending' limit 1",
    ).get(companyId);
    if (approval) return true;
    const flaggedTask = this.db.prepare(
      "select 1 from tasks where company_id = ? and requires_user_review = 1 limit 1",
    ).get(companyId);
    return !!flaggedTask;
  }

  /** Returns true if this specific agent has tasks with pending deliverable_review approvals. */
  hasAgentPendingDeliverableReview(agentId: string, companyId: string): boolean {
    const row = this.db.prepare(
      `select 1 from approvals a
       join tasks t on a.related_task_id = t.id
       where a.company_id = ? and a.type = 'deliverable_review' and a.state = 'pending'
         and t.assignee_agent_id = ?
       limit 1`,
    ).get(companyId, agentId);
    return !!row;
  }

  /** Returns true if agent has any tasks flagged requires_user_review (before approval is created). */
  hasAgentTaskAwaitingReview(agentId: string, companyId: string): boolean {
    const row = this.db.prepare(
      "select 1 from tasks where assignee_agent_id = ? and company_id = ? and requires_user_review = 1 limit 1",
    ).get(agentId, companyId);
    return !!row;
  }

  private incrementActiveSprintVelocity(companyId: string, delta: number) {
    const ts = nowIso();
    const today = ts.slice(0, 10);
    this.db.prepare(
      "update sprints set completed_points = max(0, completed_points + ?), updated_at = ? where company_id = ? and status = 'active' and start_date <= ? and end_date >= ?",
    ).run(delta, ts, companyId, today, today);
  }

  getIdleAgentsForDepartment(companyId: string, department: string): Array<{ id: string; name: string }> {
    return this.readAll(
      "select id, name from agents where company_id = ? and department = ? and status in ('idle', 'active') order by spent_monthly_usd asc",
      companyId, department,
    );
  }

  getManagerForAgent(agentId: string): { id: string; name: string; companyId: string } | null {
    const agent = this.db.prepare("select reports_to, company_id from agents where id = ?").get(agentId) as { reports_to: string | null; company_id: string } | undefined;
    if (!agent || !agent.reports_to) return null;
    const manager = this.db.prepare("select id, name from agents where id = ?").get(agent.reports_to) as { id: string; name: string } | undefined;
    return manager ? { ...manager, companyId: agent.company_id } : null;
  }

  activateWorkflow(id: string, companyId: string) {
    const row = this.db.prepare("select name, status from workflow_pipelines where id = ? and company_id = ?").get(id, companyId) as { name: string; status: string } | undefined;
    if (!row) throw new Error(`Workflow not found: ${id}`);
    if (row.status === "active") throw new Error("Workflow is already running.");
    const ts = nowIso();
    this.db.prepare(
      "update workflow_pipelines set status = 'active', current_step_index = 0, run_count = run_count + 1, last_run_at = ?, updated_at = ? where id = ?",
    ).run(ts, ts, id);
    this.addActivity({ companyId, actor: "system", action: "started", entityType: "workflow", entityId: id, detail: `Started workflow: ${row.name}` });
  }

  listTriggerableWorkflows(companyId: string, triggerType: string): WorkflowPipelineRecord[] {
    return this.readAll<SqliteRow>(
      "select id, company_id as companyId, name, description, steps_json as stepsJson, trigger_type as triggerType, trigger_config_json as triggerConfigJson, status, current_step_index as currentStepIndex, run_count as runCount, last_run_at as lastRunAt, created_at as createdAt, updated_at as updatedAt from workflow_pipelines where company_id = ? and trigger_type = ? and status = 'active' order by created_at asc",
      companyId,
      triggerType,
    ) as WorkflowPipelineRecord[];
  }

  autoAssignTask(taskId: string, companyId: string): string | null {
    const task = this.db.prepare(
      "select id, title, description, project_id as projectId, assignee_agent_id as assigneeAgentId from tasks where id = ? and company_id = ?",
    ).get(taskId, companyId) as { id: string; title: string; description: string; projectId: string | null; assigneeAgentId: string | null } | undefined;
    if (!task) return null;

    // If task already has an assignee, return them (don't reassign)
    if (task.assigneeAgentId) return task.assigneeAgentId;

    // Get eligible agents: active/idle with remaining budget
    const candidates = this.readAll<{ id: string; name: string; department: string | null; capabilities: string; taskCount: number; budgetMonthlyUsd: number; spentMonthlyUsd: number }>(
      `select a.id, a.name, a.department, a.capabilities,
        a.budget_monthly_usd as budgetMonthlyUsd, a.spent_monthly_usd as spentMonthlyUsd,
        (select count(*) from tasks t where t.assignee_agent_id = a.id and t.status in ('todo', 'in_progress')) as taskCount
      from agents a
      where a.company_id = ? and a.status in ('idle', 'active')
      order by taskCount asc`,
      companyId,
    );

    // Filter out agents who have exhausted their budget (budget=0 means unlimited)
    const eligible = candidates.filter((a) => {
      if (a.budgetMonthlyUsd > 0 && a.spentMonthlyUsd >= a.budgetMonthlyUsd) return false;
      return true;
    });

    if (eligible.length === 0) return null;

    // Score candidates by capability match, department relevance, project context, and workload
    const words = `${task.title} ${task.description}`.toLowerCase().split(/\W+/).filter(w => w.length > 3);

    // If task belongs to a project, prefer agents who lead that project or its department
    let projectDept: string | null = null;
    let projectLeadId: string | null = null;
    if (task.projectId) {
      const project = this.db.prepare("select lead_agent_id, goal_id from projects where id = ? and company_id = ?").get(task.projectId, companyId) as { lead_agent_id: string | null; goal_id: string | null } | undefined;
      projectLeadId = project?.lead_agent_id ?? null;
      if (projectLeadId) {
        const lead = this.db.prepare("select department from agents where id = ? and company_id = ?").get(projectLeadId, companyId) as { department: string | null } | undefined;
        projectDept = lead?.department ?? null;
      }
    }

    let bestAgent: string | null = null;
    let bestScore = -Infinity;

    for (const agent of eligible) {
      const capWords = agent.capabilities.toLowerCase().split(/\W+/).filter(w => w.length > 3);
      const overlap = words.filter(w => capWords.includes(w)).length;
      let score = (overlap * 10) - (agent.taskCount * 5);
      // Bonus for same department as project lead
      if (projectDept && agent.department === projectDept) score += 15;
      // Bonus for agents who are not managers (ICs should do the work)
      const hasReports = this.readAll<{ id: string }>("select id from agents where reports_to = ? limit 1", agent.id);
      if (hasReports.length === 0) score += 5;
      if (score > bestScore || (score === bestScore && agent.taskCount < (eligible.find(c => c.id === bestAgent)?.taskCount ?? 999))) {
        bestScore = score;
        bestAgent = agent.id;
      }
    }

    // Fallback: pick least loaded agent
    if (!bestAgent && eligible.length > 0) {
      bestAgent = eligible[0].id; // Already sorted by taskCount asc
    }

    this.db.prepare("update tasks set assignee_agent_id = ?, updated_at = ? where id = ? and company_id = ?").run(bestAgent, nowIso(), taskId, companyId);
    this.addActivity({
      companyId,
      actor: "system",
      action: "task.auto_assigned",
      entityType: "task",
      entityId: taskId,
      detail: `Auto-assigned to ${eligible.find(c => c.id === bestAgent)?.name ?? bestAgent}`,
    });
    return bestAgent;
  }

  private runMigrations() {
    this.db.exec(`
      create table if not exists schema_migrations (
        version integer primary key,
        name text not null,
        applied_at text not null
      );
    `);

    const applied = new Set(
      this.readAll<{ version: number }>("select version from schema_migrations")
        .map((row) => row.version),
    );

    const migrations: Array<{ version: number; name: string; sql: string }> = [
      {
        version: 1,
        name: "add_workspace_lock_lease",
        sql: `
          alter table workspaces add column lock_holder_run_id text;
          alter table workspaces add column lock_acquired_at text;
        `,
      },
      {
        version: 2,
        name: "add_approval_related_agent_id",
        sql: `
          alter table approvals add column related_agent_id text;
        `,
      },
      {
        version: 3,
        name: "add_profile_metadata",
        sql: `
          insert or ignore into settings (key, value) values ('profile_version', '1');
          insert or ignore into settings (key, value) values ('profile_created_at', '${nowIso()}');
        `,
      },
      {
        version: 4,
        name: "add_connector_capability_snapshot",
        sql: `
          alter table connectors add column capability_json text;
        `,
      },
      {
        version: 6,
        name: "add_agent_department",
        sql: `alter table agents add column department text`,
      },
      {
        version: 7,
        name: "add_meetings_table",
        sql: `
          create table if not exists meetings (
            id text primary key,
            company_id text not null,
            type text not null,
            title text not null,
            organizer_agent_id text,
            participant_agent_ids text not null default '[]',
            scheduled_at text not null,
            duration_minutes integer not null default 30,
            agenda_json text not null default '[]',
            notes_json text not null default '[]',
            decisions_json text not null default '[]',
            action_items_json text not null default '[]',
            status text not null default 'scheduled',
            created_at text not null,
            updated_at text not null
          );
          create index if not exists idx_meetings_company on meetings(company_id);
          create index if not exists idx_meetings_organizer on meetings(organizer_agent_id)
        `,
      },
      {
        version: 8,
        name: "add_documents_table",
        sql: `
          create table if not exists documents (
            id text primary key,
            company_id text not null,
            type text not null,
            title text not null,
            content text not null default '',
            author_agent_id text,
            reviewer_agent_id text,
            project_id text,
            goal_id text,
            parent_doc_id text,
            version integer not null default 1,
            status text not null default 'draft',
            tags_json text not null default '[]',
            created_at text not null,
            updated_at text not null
          );
          create index if not exists idx_documents_company on documents(company_id);
          create index if not exists idx_documents_author on documents(author_agent_id);
          create index if not exists idx_documents_project on documents(project_id)
        `,
      },
      {
        version: 9,
        name: "add_knowledge_base_table",
        sql: `
          create table if not exists knowledge_base (
            id text primary key,
            company_id text not null,
            category text not null,
            topic text not null,
            content text not null,
            author_agent_id text,
            importance text not null default 'medium',
            tags_json text not null default '[]',
            referenced_entity_type text,
            referenced_entity_id text,
            created_at text not null,
            updated_at text not null
          );
          create index if not exists idx_knowledge_company on knowledge_base(company_id);
          create index if not exists idx_knowledge_category on knowledge_base(category)
        `,
      },
      {
        version: 10,
        name: "add_sprints_table",
        sql: `
          create table if not exists sprints (
            id text primary key,
            company_id text not null,
            name text not null,
            goal text not null default '',
            start_date text not null,
            end_date text not null,
            status text not null default 'planning',
            retrospective_notes text not null default '',
            velocity_points integer not null default 0,
            completed_points integer not null default 0,
            created_at text not null,
            updated_at text not null
          );
          create index if not exists idx_sprints_company on sprints(company_id)
        `,
      },
      {
        version: 11,
        name: "add_automation_messages_workflows",
        sql: `
          create table if not exists automation_rules (
            id text primary key,
            company_id text not null,
            name text not null,
            description text not null default '',
            trigger text not null,
            conditions_json text not null default '{}',
            action text not null,
            action_config_json text not null default '{}',
            source_department text,
            target_department text,
            priority integer not null default 50,
            status text not null default 'active',
            execution_count integer not null default 0,
            last_executed_at text,
            created_at text not null,
            updated_at text not null
          );
          create index if not exists idx_automation_rules_company on automation_rules(company_id);
          create index if not exists idx_automation_rules_trigger on automation_rules(trigger);

          create table if not exists agent_messages (
            id text primary key,
            company_id text not null,
            from_agent_id text not null,
            to_agent_id text,
            channel text not null default 'direct',
            channel_target_id text,
            subject text not null,
            body text not null,
            priority text not null default 'normal',
            read_at text,
            parent_message_id text,
            attachments_json text not null default '[]',
            created_at text not null
          );
          create index if not exists idx_agent_messages_company on agent_messages(company_id);
          create index if not exists idx_agent_messages_to on agent_messages(to_agent_id);
          create index if not exists idx_agent_messages_from on agent_messages(from_agent_id);
          create index if not exists idx_agent_messages_channel on agent_messages(channel);

          create table if not exists workflow_pipelines (
            id text primary key,
            company_id text not null,
            name text not null,
            description text not null default '',
            steps_json text not null default '[]',
            trigger_type text not null,
            trigger_config_json text not null default '{}',
            status text not null default 'draft',
            current_step_index integer not null default 0,
            run_count integer not null default 0,
            last_run_at text,
            created_at text not null,
            updated_at text not null
          );
          create index if not exists idx_workflows_company on workflow_pipelines(company_id);

          create table if not exists automation_log (
            id text primary key,
            company_id text not null,
            rule_id text not null,
            rule_name text not null,
            trigger text not null,
            action text not null,
            detail text not null default '',
            executed_at text not null
          );
          create index if not exists idx_automation_log_company on automation_log(company_id)
        `,
      },
      {
        version: 12,
        name: "add_agent_message_reads",
        sql: `
          create table if not exists agent_message_reads (
            message_id text not null,
            agent_id text not null,
            read_at text not null,
            primary key (message_id, agent_id)
          );
          create index if not exists idx_agent_message_reads_agent on agent_message_reads(agent_id);
        `,
      },
    ];

    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      try {
        this.transaction(() => {
          for (const stmt of migration.sql.split(";").map((s) => s.trim()).filter(Boolean)) {
            this.db.prepare(stmt).run();
          }
          this.db
            .prepare("insert into schema_migrations (version, name, applied_at) values (?, ?, ?)")
            .run(migration.version, migration.name, nowIso());
        });
      } catch (error) {
        // Only swallow "duplicate column" errors — these happen when
        // ensureOptionalColumns already added the column before the migration
        // system existed. All other errors must propagate.
        const message = error instanceof Error ? error.message : String(error);
        const isDuplicateColumn = /duplicate column|already exists/i.test(message);
        if (isDuplicateColumn) {
          // Idempotent case: column existed, mark migration as applied
          this.db
            .prepare("insert or ignore into schema_migrations (version, name, applied_at) values (?, ?, ?)")
            .run(migration.version, migration.name, nowIso());
        } else {
          // Real failure: disk error, SQL syntax, table corruption, etc.
          // Do NOT mark as applied — the migration must be retried on next startup.
          throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${message}`);
        }
      }
    }
  }

  private migrateSecretsTable() {
    const columns = this.readAll<{ name: string }>("pragma table_info(secrets)");
    if (columns.some((column) => column.name === "company_id")) {
      this.db.prepare("create unique index if not exists secrets_company_name_idx on secrets(company_id, name)").run();
      return;
    }

    const fallbackCompanyId =
      ((this.db.prepare("select value from settings where key = 'current_company_id'").get() as { value: string } | undefined)?.value) ??
      ((this.db.prepare("select id from companies order by created_at asc limit 1").get() as { id: string } | undefined)?.id) ??
      "00000000-0000-0000-0000-000000000000";

    this.db.exec(`
      alter table secrets rename to secrets_legacy;
      create table secrets (
        id text primary key,
        company_id text not null,
        name text not null,
        description text not null,
        backend text not null,
        ciphertext blob not null,
        updated_at text not null,
        created_at text not null,
        unique(company_id, name)
      );
    `);
    this.db
      .prepare(
        "insert into secrets (id, company_id, name, description, backend, ciphertext, updated_at, created_at) select id, ?, name, description, backend, ciphertext, updated_at, created_at from secrets_legacy",
      )
      .run(fallbackCompanyId);
    this.db.exec("drop table secrets_legacy;");
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private validateBackupDirectory(sourceDir: string) {
    const validationDb = new DatabaseSync(join(sourceDir, "profile.sqlite"));
    try {
      const requiredTables = ["settings", "companies", "connectors"] as const;
      for (const table of requiredTables) {
        const row = validationDb
          .prepare("select name from sqlite_master where type = 'table' and name = ?")
          .get(table) as { name: string } | undefined;
        if (!row) {
          throw new Error(`Backup is missing the required table "${table}".`);
        }
      }
    } finally {
      validationDb.close();
    }
  }

  private async applyBackup(sourceDir: string) {
    await rm(this.dbPath, { force: true });
    await rm(`${this.dbPath}-wal`, { force: true });
    await rm(`${this.dbPath}-shm`, { force: true });

    await copyFile(join(sourceDir, "profile.sqlite"), this.dbPath);
    await copyIfExists(join(sourceDir, "profile.sqlite-wal"), `${this.dbPath}-wal`);
    await copyIfExists(join(sourceDir, "profile.sqlite-shm"), `${this.dbPath}-shm`);

    await rm(this.logsDir, { recursive: true, force: true });
    await rm(this.artifactsDir, { recursive: true, force: true });
    mkdirSync(this.logsDir, { recursive: true });
    mkdirSync(this.artifactsDir, { recursive: true });

    if (existsSync(join(sourceDir, "logs"))) {
      await cp(join(sourceDir, "logs"), this.logsDir, { recursive: true, force: true });
    }
    if (existsSync(join(sourceDir, "artifacts"))) {
      await cp(join(sourceDir, "artifacts"), this.artifactsDir, { recursive: true, force: true });
    }
    await copyIfExists(join(sourceDir, "vault.key"), join(this.profileDir, "vault.key"));
    await copyIfExists(join(sourceDir, "agent-api-signing.key"), join(this.profileDir, "agent-api-signing.key"));
    if (existsSync(join(this.profileDir, "vault.key"))) {
      chmodSync(join(this.profileDir, "vault.key"), 0o600);
    }
    if (existsSync(join(this.profileDir, "agent-api-signing.key"))) {
      chmodSync(join(this.profileDir, "agent-api-signing.key"), 0o600);
    }

    this.db = this.openConnection();
    this.init();
  }

  getInbox(companyId: string): InboxItem[] {
    const items: InboxItem[] = [];
    const snapshot = this.listSnapshot({ companyId });
    const agents = snapshot.agents;
    const agentMap = new Map(agents.map(a => [a.id, a]));

    // Pending approvals
    for (const approval of snapshot.approvals.filter(a => a.companyId === companyId && a.state === "pending")) {
      const requester = agentMap.get(approval.requestedByAgentId ?? "");
      items.push({
        id: `approval-${approval.id}`,
        type: "pending_approval",
        title: approval.payloadSummary,
        subtitle: `${approval.type.replaceAll("_", " ")} — requested by ${requester?.name ?? "Unknown"}`,
        severity: approval.type === "dangerous_command" ? "critical" : "high",
        entityType: "approval",
        entityId: approval.id,
        agentId: approval.requestedByAgentId,
        agentName: requester?.name ?? null,
        createdAt: approval.createdAt,
      });
    }

    // Failed runs (last 24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    for (const run of snapshot.runs.filter(r => r.companyId === companyId && (r.status === "failed" || r.status === "timed_out") && r.createdAt > oneDayAgo)) {
      const agent = agentMap.get(run.agentId);
      items.push({
        id: `run-${run.id}`,
        type: "failed_run",
        title: run.summary || "Run failed",
        subtitle: `${agent?.name ?? "Unknown agent"} — ${run.errorMessage?.slice(0, 100) ?? "Unknown error"}`,
        severity: "high",
        entityType: "run",
        entityId: run.id,
        agentId: run.agentId,
        agentName: agent?.name ?? null,
        createdAt: run.createdAt,
      });
    }

    // Budget warnings (agents at >80% budget)
    for (const agent of agents.filter(a => a.budgetMonthlyUsd > 0 && a.spentMonthlyUsd / a.budgetMonthlyUsd > 0.8)) {
      const pct = Math.round((agent.spentMonthlyUsd / agent.budgetMonthlyUsd) * 100);
      items.push({
        id: `budget-${agent.id}`,
        type: "budget_warning",
        title: `${agent.name} at ${pct}% budget`,
        subtitle: `$${agent.spentMonthlyUsd.toFixed(2)} of $${agent.budgetMonthlyUsd.toFixed(2)} monthly limit`,
        severity: pct >= 100 ? "critical" : "high",
        entityType: "agent",
        entityId: agent.id,
        agentId: agent.id,
        agentName: agent.name,
        createdAt: agent.updatedAt,
      });
    }

    // Blocked tasks
    for (const task of snapshot.tasks.filter(t => t.companyId === companyId && t.status === "blocked")) {
      const assignee = agentMap.get(task.assigneeAgentId ?? "");
      items.push({
        id: `blocked-${task.id}`,
        type: "blocked_task",
        title: task.title,
        subtitle: `Assigned to ${assignee?.name ?? "Unassigned"} — blocked`,
        severity: task.priority === "critical" ? "critical" : "medium",
        entityType: "task",
        entityId: task.id,
        agentId: task.assigneeAgentId,
        agentName: assignee?.name ?? null,
        createdAt: task.updatedAt,
      });
    }

    // Tasks needing review
    for (const task of snapshot.tasks.filter(t => t.companyId === companyId && t.status === "in_review")) {
      const assignee = agentMap.get(task.assigneeAgentId ?? "");
      items.push({
        id: `review-${task.id}`,
        type: "review_needed",
        title: task.title,
        subtitle: `Submitted by ${assignee?.name ?? "Unknown"} — awaiting review`,
        severity: task.priority === "critical" ? "high" : "medium",
        entityType: "task",
        entityId: task.id,
        agentId: task.assigneeAgentId,
        agentName: assignee?.name ?? null,
        createdAt: task.updatedAt,
      });
    }

    // Unread urgent agent messages (company-wide or incident channels that the Board should see)
    for (const msg of snapshot.agentMessages.filter(m =>
      m.companyId === companyId &&
      !m.readAt &&
      (m.channel === "company" || m.channel === "incident" || m.priority === "urgent"),
    )) {
      const sender = agentMap.get(msg.fromAgentId);
      items.push({
        id: `message-${msg.id}`,
        type: "agent_message",
        title: msg.subject,
        subtitle: `${sender?.name ?? "Unknown"} — ${msg.channel === "incident" ? "INCIDENT" : msg.channel} ${msg.priority === "urgent" ? "(urgent)" : ""}`,
        severity: msg.priority === "urgent" || msg.channel === "incident" ? "critical" : "medium",
        entityType: "message",
        entityId: msg.id,
        agentId: msg.fromAgentId,
        agentName: sender?.name ?? null,
        createdAt: msg.createdAt,
      });
    }

    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    items.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return items;
  }

  getCompanyMetrics(companyId: string, days: number = 30): CompanyMetrics {
    const snapshot = this.listSnapshot({ companyId });
    const agents = snapshot.agents;
    const tasks = snapshot.tasks;
    const runs = snapshot.runs;
    const costs = snapshot.costs;

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const recentRuns = runs.filter(r => r.createdAt > cutoff);
    const recentTasks = tasks.filter(t => t.status === "done" && t.updatedAt > cutoff);

    const successfulRuns = recentRuns.filter(r => r.status === "succeeded").length;
    const failedRuns = recentRuns.filter(r => r.status === "failed" || r.status === "timed_out").length;
    const totalCost = costs.reduce((sum, c) => sum + (c.amountUsd ?? 0), 0);
    const completedTasks = tasks.filter(t => t.status === "done").length;

    const agentMetrics: AgentMetrics[] = agents
      .filter(a => a.status !== "pending_approval" && a.status !== "terminated")
      .map(agent => {
        const agentTasks = tasks.filter(t => t.assigneeAgentId === agent.id);
        const agentRuns = runs.filter(r => r.agentId === agent.id);
        const agentRecentRuns = agentRuns.filter(r => r.createdAt > cutoff);
        const agentCosts = costs.filter(c => c.agentId === agent.id);

        const agentSucceeded = agentRecentRuns.filter(r => r.status === "succeeded").length;
        const agentFailed = agentRecentRuns.filter(r => r.status === "failed" || r.status === "timed_out").length;

        // Avg run duration
        const finishedRuns = agentRuns.filter(r => r.startedAt && r.finishedAt);
        const avgDuration = finishedRuns.length > 0
          ? finishedRuns.reduce((sum, r) => sum + (new Date(r.finishedAt!).getTime() - new Date(r.startedAt!).getTime()) / 1000, 0) / finishedRuns.length
          : 0;

        // Review cycles: count task status transitions by this agent
        // Actual action strings: "task.status_changed" (api-server), "task.updated" (index.ts), "task.auto_assigned" (database)
        const reviewCycles = snapshot.activity.filter(
          a => a.companyId === companyId && a.actor === agent.id
            && (a.action === "task.status_changed" || a.action === "task.updated" || a.action === "task.auto_assigned")
        ).length;

        const lastRun = agentRuns.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

        return {
          agentId: agent.id,
          agentName: agent.name,
          tasksCompleted: agentTasks.filter(t => t.status === "done").length,
          tasksAssigned: agentTasks.filter(t => t.status !== "done" && t.status !== "cancelled").length,
          tasksFailed: agentTasks.filter(t => t.status === "cancelled").length,
          successRate: agentRecentRuns.length > 0 ? Math.round((agentSucceeded / agentRecentRuns.length) * 100) : 0,
          avgRunDurationSec: Math.round(avgDuration),
          totalCostUsd: agentCosts.reduce((sum, c) => sum + (c.amountUsd ?? 0), 0),
          runsTotal: agentRecentRuns.length,
          runsSucceeded: agentSucceeded,
          runsFailed: agentFailed,
          reviewCycles,
          lastActiveAt: lastRun?.createdAt ?? null,
        };
      });

    return {
      totalAgents: agents.filter(a => a.status !== "pending_approval" && a.status !== "terminated").length,
      activeAgents: agents.filter(a => a.status === "active" || a.status === "running").length,
      totalTasks: tasks.length,
      completedTasks,
      blockedTasks: tasks.filter(t => t.status === "blocked").length,
      totalRuns: recentRuns.length,
      successfulRuns,
      failedRuns,
      overallSuccessRate: recentRuns.length > 0 ? Math.round((successfulRuns / recentRuns.length) * 100) : 0,
      totalCostUsd: totalCost,
      avgCostPerTask: completedTasks > 0 ? totalCost / completedTasks : 0,
      throughputTasksPerDay: days > 0 ? recentTasks.length / days : 0,
      agentMetrics,
    };
  }

  getStandupReport(companyId: string): StandupReport {
    const snapshot = this.listSnapshot({ companyId });
    const agents = snapshot.agents.filter(a => a.status !== "terminated" && a.status !== "pending_approval");
    const tasks = snapshot.tasks;
    const runs = snapshot.runs;
    const costs = snapshot.costs;

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recentActivity = snapshot.activity.filter(a => a.companyId === companyId && a.createdAt > oneDayAgo);

    const companyHighlights: string[] = [];
    const blockers: string[] = [];

    const recentCompletedTasks = tasks.filter(t => t.status === "done" && t.updatedAt > oneDayAgo);
    if (recentCompletedTasks.length > 0) {
      companyHighlights.push(`${recentCompletedTasks.length} task(s) completed in last 24h`);
    }

    const recentRuns = runs.filter(r => r.createdAt > oneDayAgo);
    const successfulRuns = recentRuns.filter(r => r.status === "succeeded").length;
    const failedRuns = recentRuns.filter(r => r.status === "failed" || r.status === "timed_out").length;
    if (recentRuns.length > 0) {
      companyHighlights.push(`${recentRuns.length} runs (${successfulRuns} succeeded, ${failedRuns} failed)`);
    }

    const blockedTasks = tasks.filter(t => t.status === "blocked");
    for (const task of blockedTasks) {
      const assignee = agents.find(a => a.id === task.assigneeAgentId);
      blockers.push(`${task.title} — blocked (${assignee?.name ?? "unassigned"})`);
    }

    const pendingApprovals = snapshot.approvals.filter(a => a.companyId === companyId && a.state === "pending").length;
    const totalBudget = agents.reduce((sum, a) => sum + a.budgetMonthlyUsd, 0);
    const totalSpent = agents.reduce((sum, a) => sum + a.spentMonthlyUsd, 0);
    const budgetUtilization = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

    // Active sprint progress
    const activeSprint = snapshot.sprints.find(s => s.companyId === companyId && s.status === "active");
    if (activeSprint) {
      const pct = activeSprint.velocityPoints > 0 ? Math.round((activeSprint.completedPoints / activeSprint.velocityPoints) * 100) : 0;
      companyHighlights.push(`Sprint "${activeSprint.name}": ${activeSprint.completedPoints}/${activeSprint.velocityPoints} pts (${pct}%)`);
    }

    // Unread messages requiring attention
    const urgentUnread = snapshot.agentMessages.filter(m => m.companyId === companyId && !m.readAt && (m.priority === "urgent" || m.channel === "incident")).length;
    if (urgentUnread > 0) {
      blockers.push(`${urgentUnread} urgent unread message(s) need attention`);
    }

    const agentReports = agents.map(agent => {
      const agentTasks = tasks.filter(t => t.assigneeAgentId === agent.id);
      const agentRuns = runs.filter(r => r.agentId === agent.id);
      const agentRecentRuns = agentRuns.filter(r => r.createdAt > oneDayAgo);
      const agentCosts = costs.filter(c => c.agentId === agent.id && c.createdAt > oneDayAgo);
      const lastRun = agentRecentRuns.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

      const highlights: string[] = [];
      const completedRecently = agentTasks.filter(t => t.status === "done" && t.updatedAt > oneDayAgo);
      if (completedRecently.length > 0) highlights.push(`Completed ${completedRecently.length} task(s)`);
      if (agentRecentRuns.length > 0) highlights.push(`${agentRecentRuns.length} run(s) in last 24h`);
      const reviewedTasks = recentActivity.filter(a => a.actor === agent.id && (a.action === "task.status_changed" || a.action === "task.updated" || a.action === "task.auto_assigned")).length;
      if (reviewedTasks > 0) highlights.push(`${reviewedTasks} status update(s)`);

      return {
        agentId: agent.id,
        agentName: agent.name,
        role: agent.role,
        status: agent.status,
        tasksInProgress: agentTasks.filter(t => t.status === "in_progress").length,
        tasksCompleted24h: completedRecently.length,
        tasksBlocked: agentTasks.filter(t => t.status === "blocked").length,
        lastRunStatus: (lastRun?.status ?? null) as RunStatus | null,
        lastRunAt: lastRun?.createdAt ?? null,
        costLast24h: agentCosts.reduce((sum, c) => sum + (c.amountUsd ?? 0), 0),
        highlights,
      };
    });

    const summaryParts: string[] = [];
    if (agents.length > 0) summaryParts.push(`${agents.length} active agents`);
    summaryParts.push(`${recentCompletedTasks.length} tasks done`);
    if (blockedTasks.length > 0) summaryParts.push(`${blockedTasks.length} blocked`);
    if (pendingApprovals > 0) summaryParts.push(`${pendingApprovals} pending approvals`);

    return {
      companyId,
      generatedAt: new Date().toISOString(),
      summary: summaryParts.join(" · "),
      agentReports,
      companyHighlights,
      blockers,
      pendingApprovals,
      budgetUtilization,
    };
  }

  // ---------------------------------------------------------------------------
  // Task retry and type helpers (used by connector-matching and crash-recovery)
  // ---------------------------------------------------------------------------

  getTaskRetryCount(taskId: string): number {
    const row = this.db
      .prepare("select retry_count from tasks where id = ?")
      .get(taskId) as { retry_count: number } | undefined;
    return row?.retry_count ?? 0;
  }

  incrementTaskRetryCount(taskId: string): void {
    const ts = nowIso();
    this.db
      .prepare(
        "update tasks set retry_count = retry_count + 1, last_failure_at = ?, updated_at = ? where id = ?",
      )
      .run(ts, ts, taskId);
  }

  resetTaskRetryCount(taskId: string): void {
    const ts = nowIso();
    this.db
      .prepare(
        "update tasks set retry_count = 0, last_failure_at = null, updated_at = ? where id = ?",
      )
      .run(ts, taskId);
  }

  // ---------------------------------------------------------------------------
  // Crash recovery helpers
  // ---------------------------------------------------------------------------

  getInterruptedRunsForRecovery(): Array<{
    runId: string;
    taskId: string;
    taskTitle: string;
    agentId: string;
    agentName: string;
    connectorId: string;
    interruptedAt: string;
  }> {
    return this.readAll<{
      runId: string;
      taskId: string;
      taskTitle: string;
      agentId: string;
      agentName: string;
      connectorId: string;
      interruptedAt: string;
    }>(
      `select r.id as runId, r.task_id as taskId, t.title as taskTitle,
              r.agent_id as agentId, a.name as agentName,
              r.connector_id as connectorId, r.finished_at as interruptedAt
       from runs r
       join tasks t on t.id = r.task_id
       join agents a on a.id = r.agent_id
       where r.status = 'interrupted'
       and t.status = 'blocked'
       order by r.finished_at desc`
    );
  }

  retryInterruptedTask(taskId: string, _agentId: string, _companyId: string): void {
    const ts = nowIso();
    this.db.prepare("update tasks set status = 'todo', updated_at = ? where id = ?").run(ts, taskId);
    this.db.prepare("update tasks set retry_count = 0, last_failure_at = null, updated_at = ? where id = ?").run(ts, taskId);
  }

  dismissInterruptedTask(taskId: string): void {
    const taskRow = this.db.prepare("select company_id from tasks where id = ?").get(taskId) as { company_id: string } | undefined;
    this.addComment({
      companyId: taskRow?.company_id ?? '',
      taskId,
      authorAgentId: null,
      authorName: "System",
      body: "Interrupted run dismissed by user. Task remains blocked for manual handling.",
    });
  }

  markInterruptedTaskFailed(taskId: string): void {
    const ts = nowIso();
    this.db.prepare("update tasks set status = 'cancelled', updated_at = ? where id = ?").run(ts, taskId);
  }

  setTaskType(taskId: string, taskType: string): void {
    const ts = nowIso();
    this.db
      .prepare("update tasks set task_type = ?, updated_at = ? where id = ?")
      .run(taskType, ts, taskId);
  }

  private openConnection(): SqliteDatabase {
    return new DatabaseSync(this.dbPath);
  }
}

async function copyIfExists(source: string, destination: string) {
  if (!existsSync(source)) {
    return;
  }
  await copyFile(source, destination);
}
