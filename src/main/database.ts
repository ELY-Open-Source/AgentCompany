import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { appendFile, copyFile, cp, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync, backup as backupDatabase, type SQLInputValue } from "node:sqlite";
import { getConnectorDefinition, buildDefaultConnectorRows, parseEnvBindingText } from "./connectors";
import { SecretVault } from "./vault";
import type {
  ActivityRecord,
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
  RunRecord,
  RunStatus,
  SecretRecord,
  SocialAccountRecord,
  StandupReport,
  TaskRecord,
  WorkspaceRecord,
} from "@shared/types";

type SqliteDatabase = DatabaseSync;

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
    `);

    // Step 3: Deferred wake queue — prevents silent wake loss when agent is busy
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

    // secrets index must run AFTER migrateSecretsTable adds company_id column
    this.db.exec(`create index if not exists idx_secrets_company on secrets(company_id);`);

    // Forward-only migration system
    this.runMigrations();

    this.seedSettings();
    this.seedConnectors();
    this.interruptStaleRuns();
    // Purge expired run logs based on retention setting
    this.purgeExpiredRunLogs();
  }

  close() {
    this.db.close();
  }

  getProfilePath() {
    return this.profileDir;
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

  belongsToCompany(table: "workspaces" | "agents" | "goals" | "projects" | "tasks" | "approvals" | "runs" | "secrets", id: string, companyId: string) {
    const queries: Record<string, string> = {
      workspaces: "select 1 as present from workspaces where id = ? and company_id = ?",
      agents: "select 1 as present from agents where id = ? and company_id = ?",
      goals: "select 1 as present from goals where id = ? and company_id = ?",
      projects: "select 1 as present from projects where id = ? and company_id = ?",
      tasks: "select 1 as present from tasks where id = ? and company_id = ?",
      approvals: "select 1 as present from approvals where id = ? and company_id = ?",
      runs: "select 1 as present from runs where id = ? and company_id = ?",
      secrets: "select 1 as present from secrets where id = ? and company_id = ?",
    };
    const sql = queries[table];
    if (!sql) throw new Error(`Unknown table: ${table}`);
    const row = this.db.prepare(sql).get(id, companyId) as { present: number } | undefined;
    return Boolean(row?.present);
  }

  canOpenPath(targetPath: string) {
    if (!targetPath || !existsSync(targetPath)) {
      return false;
    }

    const managedRoots = [this.profileDir, this.logsDir, this.artifactsDir, this.backupsDir];
    if (managedRoots.some((rootPath) => isWithinOrEqual(targetPath, rootPath))) {
      return true;
    }

    const workspaces = this.readAll<{ localPath: string }>("select local_path as localPath from workspaces");
    if (workspaces.some((workspace) => isWithinOrEqual(targetPath, workspace.localPath))) {
      return true;
    }

    const runLogs = this.readAll<{ logPath: string | null }>("select log_path as logPath from runs where log_path is not null");
    return runLogs.some((run) => run.logPath ? resolve(run.logPath) === resolve(targetPath) : false);
  }

  updateSettings(input: { theme?: "system" | "light" | "dark"; updatesEnabled?: boolean; logRetentionDays?: number }) {
    if (input.theme) {
      this.setSetting("theme", input.theme);
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

  /**
   * Purge run logs older than the retention window.
   * Deletes the log file and clears the log_path column.
   * Returns the number of runs purged.
   */
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
          // File may already be gone — that's fine
        }
      }
      this.db
        .prepare("update runs set log_path = null, updated_at = ? where id = ?")
        .run(nowIso(), run.id);
      purged++;
    }
    return purged;
  }

  listSnapshot(): ProfileSnapshot {
    const connectors = this.readConnectors();
    const theme = (this.getSetting("theme") as "system" | "light" | "dark" | null) ?? "system";
    return {
      currentCompanyId: this.getCurrentCompanyId(),
      profilePath: this.profileDir,
      updatesEnabled: this.getSetting("updates_enabled") !== "false",
      theme,
      backend: {
        secretBackend: this.vault.getBackendLabel(),
      },
      companies: this.readAll<CompanyRecord>(
        "select id, name, description, status, auto_approve_hires as autoApproveHires, created_at as createdAt, updated_at as updatedAt from companies order by created_at asc",
      ).map((record) => ({ ...record, autoApproveHires: toBoolean(record.autoApproveHires) })) as CompanyRecord[],
      connectors,
      workspaces: this.readAll<WorkspaceRecord>(
        "select id, company_id as companyId, name, local_path as localPath, repo_url as repoUrl, repo_ref as repoRef, project_id as projectId, state, is_primary as isPrimary, created_at as createdAt, updated_at as updatedAt from workspaces order by created_at desc",
      ).map((record) => ({ ...record, isPrimary: toBoolean(record.isPrimary) })) as WorkspaceRecord[],
      agents: this.readAll<AgentRecord>(
        "select id, company_id as companyId, name, role, title, department, status, reports_to as reportsTo, connector_id as connectorId, workspace_id as workspaceId, model, capabilities, budget_monthly_usd as budgetMonthlyUsd, spent_monthly_usd as spentMonthlyUsd, metadata_json as metadataJson, heartbeat_enabled as heartbeatEnabled, heartbeat_interval_sec as heartbeatIntervalSec, last_heartbeat_at as lastHeartbeatAt, created_at as createdAt, updated_at as updatedAt from agents order by created_at asc",
      ).map((record) => ({ ...record, heartbeatEnabled: toBoolean(record.heartbeatEnabled) })) as AgentRecord[],
      goals: this.readAll<GoalRecord>(
        "select id, company_id as companyId, title, description, parent_id as parentId, owner_agent_id as ownerAgentId, status, created_at as createdAt, updated_at as updatedAt from goals order by created_at asc",
      ),
      projects: this.readAll<ProjectRecord>(
        "select id, company_id as companyId, goal_id as goalId, name, description, lead_agent_id as leadAgentId, status, target_date as targetDate, created_at as createdAt, updated_at as updatedAt from projects order by created_at desc",
      ),
      tasks: this.readAll<TaskRecord>(
        "select id, company_id as companyId, project_id as projectId, goal_id as goalId, parent_id as parentId, title, description, assignee_agent_id as assigneeAgentId, workspace_id as workspaceId, status, priority, active_run_id as activeRunId, session_json as sessionJson, session_display_id as sessionDisplayId, cost_usd as costUsd, created_at as createdAt, updated_at as updatedAt from tasks order by created_at desc",
      ),
      approvals: this.readAll<ApprovalRecord>(
        "select id, company_id as companyId, related_task_id as relatedTaskId, related_agent_id as relatedAgentId, requested_by_agent_id as requestedByAgentId, type, payload_summary as payloadSummary, impact_summary as impactSummary, payload_json as payloadJson, decision_note as decisionNote, state, created_at as createdAt, updated_at as updatedAt from approvals order by created_at desc",
      ),
      runs: this.readAll<RunRecord>(
        "select id, company_id as companyId, task_id as taskId, agent_id as agentId, workspace_id as workspaceId, connector_id as connectorId, status, summary, error_message as errorMessage, exit_code as exitCode, signal, model, session_display_id as sessionDisplayId, cost_usd as costUsd, unattributed_cost as unattributedCost, started_at as startedAt, finished_at as finishedAt, log_path as logPath, created_at as createdAt, updated_at as updatedAt from runs order by created_at desc limit 500",
      ).map((record) => ({ ...record, unattributedCost: Boolean(record.unattributedCost) })) as RunRecord[],
      costs: this.readAll<CostRecord>(
        "select id, company_id as companyId, run_id as runId, task_id as taskId, agent_id as agentId, connector_id as connectorId, amount_usd as amountUsd, unattributed, created_at as createdAt from cost_entries order by created_at desc limit 500",
      ).map((entry) => ({ ...entry, unattributed: Boolean(entry.unattributed) })) as CostRecord[],
      activity: this.readAll<ActivityRecord>(
        "select id, company_id as companyId, actor, action, entity_type as entityType, entity_id as entityId, detail, created_at as createdAt from activity order by created_at desc limit 250",
      ),
      secrets: this.readAll<SecretRecord>(
        "select id, company_id as companyId, name, description, backend, updated_at as updatedAt from secrets order by updated_at desc",
      ),
      comments: this.readAll<CommentRecord>(
        "select id, company_id as companyId, task_id as taskId, author_agent_id as authorAgentId, author_name as authorName, body, created_at as createdAt from task_comments order by created_at asc",
      ),
      socialAccounts: this.readAll<any>(
        "select id, company_id, platform, account_name, display_name, profile_url, credential_secret_id, status, require_approval, metadata_json, last_used_at, created_at, updated_at from social_accounts order by created_at desc",
      ).map((r: any) => ({
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
      browserActions: [],
      meetings: this.readAll<any>(
        "select id, company_id, type, title, organizer_agent_id, participant_agent_ids, scheduled_at, duration_minutes, agenda_json, notes_json, decisions_json, action_items_json, status, created_at, updated_at from meetings order by scheduled_at desc",
      ).map((r: any) => ({
        id: r.id, companyId: r.company_id, type: r.type, title: r.title, organizerAgentId: r.organizer_agent_id,
        participantAgentIds: r.participant_agent_ids, scheduledAt: r.scheduled_at, durationMinutes: r.duration_minutes,
        agendaJson: r.agenda_json, notesJson: r.notes_json, decisionsJson: r.decisions_json,
        actionItemsJson: r.action_items_json, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
      })),
      documents: this.readAll<any>(
        "select id, company_id, type, title, content, author_agent_id, reviewer_agent_id, project_id, goal_id, parent_doc_id, version, status, tags_json, created_at, updated_at from documents order by updated_at desc",
      ).map((r: any) => ({
        id: r.id, companyId: r.company_id, type: r.type, title: r.title, content: r.content,
        authorAgentId: r.author_agent_id, reviewerAgentId: r.reviewer_agent_id, projectId: r.project_id,
        goalId: r.goal_id, parentDocId: r.parent_doc_id, version: r.version, status: r.status,
        tagsJson: r.tags_json, createdAt: r.created_at, updatedAt: r.updated_at,
      })),
      knowledgeBase: this.readAll<any>(
        "select id, company_id, category, topic, content, author_agent_id, importance, tags_json, referenced_entity_type, referenced_entity_id, created_at, updated_at from knowledge_base order by updated_at desc",
      ).map((r: any) => ({
        id: r.id, companyId: r.company_id, category: r.category, topic: r.topic, content: r.content,
        authorAgentId: r.author_agent_id, importance: r.importance, tagsJson: r.tags_json,
        referencedEntityType: r.referenced_entity_type, referencedEntityId: r.referenced_entity_id,
        createdAt: r.created_at, updatedAt: r.updated_at,
      })),
      sprints: this.readAll<any>(
        "select id, company_id, name, goal, start_date, end_date, status, retrospective_notes, velocity_points, completed_points, created_at, updated_at from sprints order by start_date desc",
      ).map((r: any) => ({
        id: r.id, companyId: r.company_id, name: r.name, goal: r.goal,
        startDate: r.start_date, endDate: r.end_date, status: r.status,
        retrospectiveNotes: r.retrospective_notes, velocityPoints: r.velocity_points,
        completedPoints: r.completed_points, createdAt: r.created_at, updatedAt: r.updated_at,
      })),
      automationRules: this.readAll<any>(
        "select id, company_id, name, description, trigger, conditions_json, action, action_config_json, source_department, target_department, priority, status, execution_count, last_executed_at, created_at, updated_at from automation_rules order by priority desc, created_at desc",
      ).map((r: any) => ({
        id: r.id, companyId: r.company_id, name: r.name, description: r.description,
        trigger: r.trigger, conditionsJson: r.conditions_json, action: r.action,
        actionConfigJson: r.action_config_json, sourceDepartment: r.source_department,
        targetDepartment: r.target_department, priority: r.priority, status: r.status,
        executionCount: r.execution_count, lastExecutedAt: r.last_executed_at,
        createdAt: r.created_at, updatedAt: r.updated_at,
      })),
      agentMessages: this.readAll<any>(
        "select id, company_id, from_agent_id, to_agent_id, channel, channel_target_id, subject, body, priority, read_at, parent_message_id, attachments_json, created_at from agent_messages order by created_at desc limit 200",
      ).map((r: any) => ({
        id: r.id, companyId: r.company_id, fromAgentId: r.from_agent_id,
        toAgentId: r.to_agent_id, channel: r.channel, channelTargetId: r.channel_target_id,
        subject: r.subject, body: r.body, priority: r.priority, readAt: r.read_at,
        parentMessageId: r.parent_message_id, attachmentsJson: r.attachments_json,
        createdAt: r.created_at,
      })),
      workflows: this.readAll<any>(
        "select id, company_id, name, description, steps_json, trigger_type, trigger_config_json, status, current_step_index, run_count, last_run_at, created_at, updated_at from workflow_pipelines order by created_at desc",
      ).map((r: any) => ({
        id: r.id, companyId: r.company_id, name: r.name, description: r.description,
        stepsJson: r.steps_json, triggerType: r.trigger_type, triggerConfigJson: r.trigger_config_json,
        status: r.status, currentStepIndex: r.current_step_index, runCount: r.run_count,
        lastRunAt: r.last_run_at, createdAt: r.created_at, updatedAt: r.updated_at,
      })),
    };
  }

  saveCompany(input: { id?: string | null; name: string; description: string; status: string; autoApproveHires?: boolean }) {
    const id = ensureId(input.id ?? null);
    const ts = nowIso();
    const autoApprove = input.autoApproveHires ? 1 : 0;
    const existing = this.db.prepare("select id from companies where id = ?").get(id) as { id: string } | undefined;
    if (existing) {
      this.db
        .prepare("update companies set name = ?, description = ?, status = ?, auto_approve_hires = ?, updated_at = ? where id = ?")
        .run(input.name, input.description, input.status, autoApprove, ts, id);
    } else {
      this.db
        .prepare("insert into companies (id, name, description, status, auto_approve_hires, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)")
        .run(id, input.name, input.description, input.status, autoApprove, ts, ts);
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
    const definition = getConnectorDefinition(input.id);
    this.db
      .prepare(
        "update connectors set command = ?, model = ?, env_binding_text = ?, notes = ?, updated_at = ? where id = ?",
      )
      .run(definition.defaultCommand, input.model, input.envBindingText, input.notes, nowIso(), input.id);
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
    // Extract relatedAgentId from payload for hire_agent approvals if not explicitly set
    let relatedAgentId = normalizeOptionalId(input.relatedAgentId);
    if (!relatedAgentId && input.type === "hire_agent" && input.payloadJson) {
      try {
        const payload = JSON.parse(input.payloadJson) as { agentId?: string };
        relatedAgentId = payload.agentId ?? null;
      } catch { /* ignore malformed payload */ }
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
        normalizeOptionalId(input.payloadJson),
        ts,
        ts,
      );
    return id;
  }

  decideApproval(input: { approvalId: string; state: string; decisionNote: string }) {
    const approval = this.getApprovalRecord(input.approvalId);
    if (approval.state !== "pending") {
      throw new Error(`Approval ${input.approvalId} is already ${approval.state} and cannot be re-decided.`);
    }
    const ts = nowIso();
    this.transaction(() => {
      this.db
        .prepare("update approvals set state = ?, decision_note = ?, updated_at = ? where id = ?")
        .run(input.state, input.decisionNote, ts, input.approvalId);
      if (approval.type === "hire_agent") {
        // Prefer structured related_agent_id; fall back to payload_json for legacy records
        const agentId = approval.relatedAgentId
          ?? parseJson<{ agentId?: string } | null>(approval.payloadJson, null)?.agentId
          ?? null;
        if (agentId) {
          if (input.state === "approved") {
            this.db
              .prepare("update agents set status = 'idle', updated_at = ? where id = ? and company_id = ? and status = 'pending_approval'")
              .run(ts, agentId, approval.companyId);
          }
          if (input.state === "rejected") {
            this.db
              .prepare("update agents set status = 'terminated', updated_at = ? where id = ? and company_id = ? and status = 'pending_approval'")
              .run(ts, agentId, approval.companyId);
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
    const bindings = parseEnvBindingText(bindingText);
    const result: Record<string, string> = {};
    for (const [envKey, secretName] of Object.entries(bindings)) {
      const row = this.db.prepare("select backend, ciphertext from secrets where company_id = ? and name = ?").get(companyId, secretName) as
        | { backend: "safe_storage" | "vault"; ciphertext: Uint8Array }
        | undefined;
      if (!row) continue;
      result[envKey] = this.vault.decrypt(row.backend, Buffer.from(row.ciphertext));
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
        "select id, company_id as companyId, project_id as projectId, goal_id as goalId, parent_id as parentId, title, description, assignee_agent_id as assigneeAgentId, workspace_id as workspaceId, status, priority, active_run_id as activeRunId, session_json as sessionJson, session_display_id as sessionDisplayId, cost_usd as costUsd, created_at as createdAt, updated_at as updatedAt from tasks where id = ?",
      )
      .get(id) as TaskRecord | undefined;
    if (!row) throw new Error(`Task not found: ${id}`);
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

  getProjectPrimaryWorkspace(companyId: string): WorkspaceRecord | null {
    const row = this.db
      .prepare(
        "select id, company_id as companyId, name, local_path as localPath, repo_url as repoUrl, repo_ref as repoRef, project_id as projectId, state, is_primary as isPrimary, created_at as createdAt, updated_at as updatedAt from workspaces where company_id = ? and is_primary = 1 order by created_at asc limit 1",
      )
      .get(companyId) as WorkspaceRecord | undefined;
    return row ? { ...row, isPrimary: toBoolean(row.isPrimary) } : null;
  }

  /** Get any workspace in the company (last resort fallback). */
  getAnyCompanyWorkspace(companyId: string): WorkspaceRecord | null {
    const row = this.db
      .prepare(
        "select id, company_id as companyId, name, local_path as localPath, repo_url as repoUrl, repo_ref as repoRef, project_id as projectId, state, is_primary as isPrimary, created_at as createdAt, updated_at as updatedAt from workspaces where company_id = ? order by is_primary desc, created_at asc limit 1",
      )
      .get(companyId) as WorkspaceRecord | undefined;
    return row ? { ...row, isPrimary: toBoolean(row.isPrimary) } : null;
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
    writeFileSync(logPath, "");
    return { id, logPath };
  }

  appendRunLog(runId: string, stream: "stdout" | "stderr", chunk: string) {
    const run = this.db.prepare("select log_path as logPath from runs where id = ?").get(runId) as { logPath: string | null } | undefined;
    if (!run?.logPath) return;
    return appendFile(run.logPath, `[${new Date().toISOString()}][${stream}] ${chunk}`);
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

  markRunStatus(runId: string, status: RunRecord["status"], message: string) {
    const ts = nowIso();
    const startedAt = status === "running" ? ts : null;
    this.db
      .prepare(
        "update runs set status = ?, summary = case when ? != '' then ? else summary end, started_at = coalesce(started_at, ?), updated_at = ? where id = ?",
      )
      .run(status, message, message, startedAt, ts, runId);
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
      }
    });
    return { budgetHardStopped };
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
      // Clean up tables added by migrations (safe to call — migrations run on init)
      for (const table of ["automation_rules", "automation_log", "agent_messages", "workflow_pipelines", "meetings", "documents", "knowledge_base", "sprints"]) {
        try {
          this.db.prepare(`delete from ${table} where company_id = ?`).run(companyId);
        } catch (err) {
          // Only tolerate "no such table" — re-throw anything else (disk error, etc.)
          if (!(err instanceof Error) || !err.message.includes("no such table")) throw err;
        }
      }
      this.db.prepare("delete from companies where id = ?").run(companyId);
      // Switch to another company if the deleted one was current
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
    this.transaction(() => {
      // Clear references from tasks
      this.db.prepare("update tasks set assignee_agent_id = null where assignee_agent_id = ? and company_id = ?").run(id, companyId);
      // Clear references from goals
      this.db.prepare("update goals set owner_agent_id = null where owner_agent_id = ? and company_id = ?").run(id, companyId);
      // Clear references from projects
      this.db.prepare("update projects set lead_agent_id = null where lead_agent_id = ? and company_id = ?").run(id, companyId);
      // Clear reports-to references
      this.db.prepare("update agents set reports_to = null where reports_to = ? and company_id = ?").run(id, companyId);
      // Delete the agent
      this.db.prepare("delete from agents where id = ? and company_id = ?").run(id, companyId);
    });
  }

  deleteTask(id: string, companyId: string) {
    this.transaction(() => {
      // Clear parent references
      this.db.prepare("update tasks set parent_id = null where parent_id = ? and company_id = ?").run(id, companyId);
      // Delete related approvals
      this.db.prepare("delete from approvals where related_task_id = ? and company_id = ?").run(id, companyId);
      // Delete related comments
      this.db.prepare("delete from task_comments where task_id = ? and company_id = ?").run(id, companyId);
      // Delete the task
      this.db.prepare("delete from tasks where id = ? and company_id = ?").run(id, companyId);
    });
  }

  deleteGoal(id: string, companyId: string) {
    this.transaction(() => {
      // Clear parent references
      this.db.prepare("update goals set parent_id = null where parent_id = ? and company_id = ?").run(id, companyId);
      // Clear goal references from projects
      this.db.prepare("update projects set goal_id = null where goal_id = ? and company_id = ?").run(id, companyId);
      // Clear goal references from tasks
      this.db.prepare("update tasks set goal_id = null where goal_id = ? and company_id = ?").run(id, companyId);
      // Delete the goal
      this.db.prepare("delete from goals where id = ? and company_id = ?").run(id, companyId);
    });
  }

  deleteProject(id: string, companyId: string) {
    this.transaction(() => {
      // Clear project references from tasks
      this.db.prepare("update tasks set project_id = null where project_id = ? and company_id = ?").run(id, companyId);
      // Clear project references from workspaces
      this.db.prepare("update workspaces set project_id = null where project_id = ? and company_id = ?").run(id, companyId);
      // Delete the project
      this.db.prepare("delete from projects where id = ? and company_id = ?").run(id, companyId);
    });
  }

  deleteWorkspace(id: string, companyId: string) {
    this.transaction(() => {
      // Clear workspace references from agents
      this.db.prepare("update agents set workspace_id = null where workspace_id = ? and company_id = ?").run(id, companyId);
      // Clear workspace references from tasks
      this.db.prepare("update tasks set workspace_id = null where workspace_id = ? and company_id = ?").run(id, companyId);
      // Delete the workspace
      this.db.prepare("delete from workspaces where id = ? and company_id = ?").run(id, companyId);
    });
  }

  deleteApproval(id: string, companyId: string) {
    this.db.prepare("delete from approvals where id = ? and company_id = ?").run(id, companyId);
  }

  deleteSecret(id: string, companyId: string) {
    this.db.prepare("delete from secrets where id = ? and company_id = ?").run(id, companyId);
  }

  /* ─── Social Accounts ────────────────────────────────────────────── */

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
    this.db.prepare("DELETE FROM social_accounts WHERE id = ? AND company_id = ?").run(id, companyId);
  }

  listSocialAccounts(companyId: string): SocialAccountRecord[] {
    const rows = this.db.prepare("SELECT * FROM social_accounts WHERE company_id = ? ORDER BY created_at DESC").all(companyId) as any[];
    return rows.map((r: any) => ({
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

  /* ─── Browser Actions ────────────────────────────────────────────── */

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

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r: any) => ({
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

  getSidebarBadges(companyId: string): { pendingApprovals: number; activeRuns: number; failedRuns: number; todoTasks: number; budgetWarnings: number } {
    const pendingApprovals = (this.db.prepare("select count(*) as c from approvals where company_id = ? and state = 'pending'").get(companyId) as { c: number })?.c ?? 0;
    const activeRuns = (this.db.prepare("select count(*) as c from runs where company_id = ? and status in ('queued', 'running')").get(companyId) as { c: number })?.c ?? 0;
    const failedRuns = (this.db.prepare("select count(*) as c from runs where company_id = ? and status in ('failed', 'timed_out', 'interrupted')").get(companyId) as { c: number })?.c ?? 0;
    const todoTasks = (this.db.prepare("select count(*) as c from tasks where company_id = ? and status in ('todo', 'in_progress', 'in_review')").get(companyId) as { c: number })?.c ?? 0;
    const budgetWarnings = (this.db.prepare("select count(*) as c from agents where company_id = ? and budget_monthly_usd > 0 and (spent_monthly_usd * 1.0 / budget_monthly_usd) >= 0.8").get(companyId) as { c: number })?.c ?? 0;
    return { pendingApprovals, activeRuns, failedRuns, todoTasks, budgetWarnings };
  }

  /* ─── Comments ────────────────────────────────────────────────────── */

  addComment(input: { companyId: string; taskId: string; authorAgentId: string | null; authorName: string; body: string }): CommentRecord {
    // Validate task belongs to the specified company
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

  /* ─── Heartbeat ──────────────────────────────────────────────────── */

  setHeartbeat(agentId: string, enabled: boolean, intervalSec: number) {
    this.db.prepare(
      "update agents set heartbeat_enabled = ?, heartbeat_interval_sec = ?, updated_at = ? where id = ?",
    ).run(enabled ? 1 : 0, intervalSec, nowIso(), agentId);
  }

  markHeartbeatAt(agentId: string) {
    this.db.prepare("update agents set last_heartbeat_at = ? where id = ?").run(nowIso(), agentId);
  }

  listHeartbeatEligibleAgents(companyId: string): AgentRecord[] {
    return this.readAll<AgentRecord>(
      "select id, company_id as companyId, name, role, title, department, status, reports_to as reportsTo, connector_id as connectorId, workspace_id as workspaceId, model, capabilities, budget_monthly_usd as budgetMonthlyUsd, spent_monthly_usd as spentMonthlyUsd, metadata_json as metadataJson, heartbeat_enabled as heartbeatEnabled, heartbeat_interval_sec as heartbeatIntervalSec, last_heartbeat_at as lastHeartbeatAt, created_at as createdAt, updated_at as updatedAt from agents where company_id = ? and heartbeat_enabled = 1 and status not in ('terminated', 'paused', 'error', 'pending_approval')",
      companyId,
    ).map((record) => ({ ...record, heartbeatEnabled: toBoolean(record.heartbeatEnabled) })) as AgentRecord[];
  }

  /* ─── Task Checkout (for agent API) ──────────────────────────────── */

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

  /* ─── Org helpers for agent API ──────────────────────────────────── */

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

  /* ─── Deferred Wake Queue (Step 3) ─────────────────────────────── */

  enqueuePendingWake(companyId: string, agentId: string, trigger: string) {
    this.db
      .prepare(
        "insert into pending_wakes (id, company_id, agent_id, trigger_reason, created_at) values (?, ?, ?, ?, ?)",
      )
      .run(randomUUID(), companyId, agentId, trigger, nowIso());
  }

  consumePendingWakes(agentId: string): Array<{ id: string; companyId: string; trigger: string }> {
    const rows = this.readAll<{ id: string; companyId: string; trigger: string }>(
      "select id, company_id as companyId, trigger_reason as trigger from pending_wakes where agent_id = ? order by created_at asc",
      agentId,
    );
    if (rows.length > 0) {
      this.db.prepare("delete from pending_wakes where agent_id = ?").run(agentId);
    }
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
      id: ConnectorId;
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
    return rows.map((row) => {
      const definition = getConnectorDefinition(row.id);
      return {
        id: row.id,
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
      };
    });
  }

  private seedConnectors() {
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

  private interruptStaleRuns() {
    const ts = nowIso();
    this.transaction(() => {
      this.db
        .prepare(
          "update runs set status = 'interrupted', error_message = 'AgentCompany restarted before the run could report completion.', finished_at = ?, updated_at = ? where status in ('queued', 'running')",
        )
        .run(ts, ts);
      this.db.prepare("update tasks set active_run_id = null where active_run_id is not null").run();
      // Release all workspace locks that were held by interrupted runs
      this.releaseAllWorkspaceLocks();
    });
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
    try {
      this.db.prepare("alter table connectors add column updated_at text").run();
    } catch {
      // Column already exists.
    }
    try {
      this.db.prepare("alter table approvals add column payload_json text").run();
    } catch {
      // Column already exists.
    }
    // Heartbeat columns on agents
    for (const col of [
      "alter table agents add column heartbeat_enabled integer not null default 0",
      "alter table agents add column heartbeat_interval_sec integer not null default 120",
      "alter table agents add column last_heartbeat_at text",
    ]) {
      try {
        this.db.prepare(col).run();
      } catch {
        // Column already exists.
      }
    }
    // Auto-approve column on companies
    try {
      this.db.prepare("alter table companies add column auto_approve_hires integer not null default 0").run();
    } catch {
      // Column already exists.
    }
    // Comments table
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

    // Social media accounts table
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

    // Browser actions table
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
  }

  /**
   * Check whether a run can start given pending approvals.
   * Returns null if no blocking approval exists, or the blocking approval record.
   *
   * Uses the structured `related_agent_id` column for hire_agent lookups
   * instead of fragile payload_json LIKE matching.
   */
  getBlockingApproval(companyId: string, agentId: string, taskId: string | null): ApprovalRecord | null {
    const rows = this.readAll<ApprovalRecord>(
      `select id, company_id as companyId, related_task_id as relatedTaskId,
              requested_by_agent_id as requestedByAgentId, type,
              payload_summary as payloadSummary, impact_summary as impactSummary,
              decision_note as decisionNote, state,
              created_at as createdAt, updated_at as updatedAt
       from approvals
       where company_id = ? and state = 'pending'
         and (
           (type = 'hire_agent' and related_agent_id = ?)
           or (type = 'dangerous_command' and (related_task_id = ? or requested_by_agent_id = ?))
           or (type = 'secret_access' and (related_task_id = ? or requested_by_agent_id = ?))
           or (type = 'approve_ceo_strategy' and (related_task_id = ? or requested_by_agent_id = ?))
         )
       order by created_at asc limit 1`,
      companyId,
      agentId,
      taskId ?? "",
      agentId,
      taskId ?? "",
      agentId,
      taskId ?? "",
      agentId,
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Check if an agent is pending hire approval (status = pending_approval).
   * Runs must not start for agents that haven't been approved yet.
   */
  isAgentPendingApproval(agentId: string): boolean {
    const row = this.db
      .prepare("select status from agents where id = ?")
      .get(agentId) as { status: string } | undefined;
    return row?.status === "pending_approval";
  }

  /**
   * Check if an agent's budget is exhausted (would trigger hard stop).
   */
  isAgentBudgetExhausted(agentId: string): boolean {
    const row = this.db
      .prepare("select budget_monthly_usd as budget, spent_monthly_usd as spent from agents where id = ?")
      .get(agentId) as { budget: number; spent: number } | undefined;
    if (!row || row.budget <= 0) return false;
    return row.spent >= row.budget;
  }

  /**
   * Update workspace state (ready/busy/blocked/missing/error).
   */
  setWorkspaceState(workspaceId: string, state: WorkspaceRecord["state"]) {
    this.db
      .prepare("update workspaces set state = ?, updated_at = ? where id = ?")
      .run(state, nowIso(), workspaceId);
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

  /**
   * Release a workspace write lock. Only the holding run can release it.
   */
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

  /**
   * Persist a run to the deferred queue so it survives worker restarts.
   */
  enqueueDeferredRun(runId: string) {
    this.db
      .prepare("update runs set status = 'queued', updated_at = ? where id = ? and status = 'queued'")
      .run(nowIso(), runId);
  }

  /**
   * List runs that were queued but never finished (for crash recovery re-enqueue).
   */
  listRecoverableQueuedRuns(): Array<{ id: string; taskId: string; agentId: string; companyId: string; workspaceId: string | null; connectorId: ConnectorId }> {
    return this.readAll<{ id: string; taskId: string; agentId: string; companyId: string; workspaceId: string | null; connectorId: ConnectorId }>(
      "select id, task_id as taskId, agent_id as agentId, company_id as companyId, workspace_id as workspaceId, connector_id as connectorId from runs where status = 'queued' order by created_at asc",
    );
  }

  /* ─── Meetings CRUD ────────────────────────────────────────────── */

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

  /* ─── Documents CRUD ──────────────────────────────────────────── */

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

  /* ─── Knowledge Base CRUD ─────────────────────────────────────── */

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

  /* ─── Sprints CRUD ────────────────────────────────────────────── */

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

  // ── Automation Rules ──────────────────────────────────────────────

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

  // ── Agent Messages ──────────────────────────────────────────────

  sendAgentMessage(input: {
    companyId: string; fromAgentId: string; toAgentId?: string | null;
    channel?: string; channelTargetId?: string | null; subject: string; body: string;
    priority?: string; parentMessageId?: string | null; attachmentsJson?: string;
  }) {
    const id = randomUUID();
    this.db.prepare(
      "insert into agent_messages (id, company_id, from_agent_id, to_agent_id, channel, channel_target_id, subject, body, priority, parent_message_id, attachments_json, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, input.companyId, input.fromAgentId, input.toAgentId ?? null, input.channel ?? "direct", input.channelTargetId ?? null, input.subject, input.body, input.priority ?? "normal", input.parentMessageId ?? null, input.attachmentsJson ?? "[]", nowIso());
    this.addActivity({ companyId: input.companyId, actor: input.fromAgentId, action: "sent_message", entityType: "agent_message", entityId: id, detail: `Message: ${input.subject}` });
    return id;
  }

  listAgentMessages(companyId: string, opts?: { agentId?: string; channel?: string; unreadOnly?: boolean; limit?: number }) {
    let sql = "select id, company_id as companyId, from_agent_id as fromAgentId, to_agent_id as toAgentId, channel, channel_target_id as channelTargetId, subject, body, priority, read_at as readAt, parent_message_id as parentMessageId, attachments_json as attachmentsJson, created_at as createdAt from agent_messages where company_id = ?";
    const params: SQLInputValue[] = [companyId];
    if (opts?.agentId) { sql += " and (to_agent_id = ? or from_agent_id = ? or to_agent_id is null)"; params.push(opts.agentId, opts.agentId); }
    if (opts?.channel) { sql += " and channel = ?"; params.push(opts.channel); }
    if (opts?.unreadOnly) { sql += " and read_at is null"; }
    sql += ` order by created_at desc limit ${opts?.limit ?? 50}`;
    return this.db.prepare(sql).all(...params) as any[];
  }

  markMessageRead(messageId: string, companyId: string) {
    this.db.prepare("update agent_messages set read_at = ? where id = ? and company_id = ?").run(nowIso(), messageId, companyId);
  }

  // ── Workflow Pipelines ────────────────────────────────────────────

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

  deleteWorkflow(id: string, companyId: string) {
    this.db.prepare("delete from workflow_pipelines where id = ? and company_id = ?").run(id, companyId);
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

  // ── Auto Task Assignment ──────────────────────────────────────────

  autoAssignTask(taskId: string, companyId: string): string | null {
    const task = this.db.prepare(
      "select id, title, description, project_id, assignee_agent_id from tasks where id = ? and company_id = ?",
    ).get(taskId, companyId) as { id: string; title: string; description: string; project_id: string | null; assignee_agent_id: string | null } | undefined;
    if (!task) return null;
    if (task.assignee_agent_id) return task.assignee_agent_id;

    // Find available agents (active/idle with remaining budget, exclude managers with direct reports)
    const agents = this.readAll<{ id: string; department: string | null; capabilities: string; budget_monthly_usd: number; spent_monthly_usd: number }>(
      "select id, department, capabilities, budget_monthly_usd, spent_monthly_usd from agents where company_id = ? and status in ('idle', 'active') and budget_monthly_usd > spent_monthly_usd",
      companyId,
    );
    if (agents.length === 0) return null;

    // Extract keywords from task title + description for capability matching
    const taskText = `${task.title} ${task.description}`.toLowerCase();
    const taskKeywords = taskText.split(/\W+/).filter(w => w.length > 3);

    let bestAgent: typeof agents[0] | null = null;
    let bestScore = -Infinity;

    for (const agent of agents) {
      // Workload: fewer active tasks = higher score
      const activeTasks = this.readAll<{ cnt: number }>(
        "select count(*) as cnt from tasks where assignee_agent_id = ? and status in ('todo', 'in_progress')",
        agent.id,
      )[0]?.cnt ?? 0;

      // Budget: more remaining = higher score
      const budgetRemaining = agent.budget_monthly_usd - agent.spent_monthly_usd;

      // Capability match: count overlapping keywords between task and agent capabilities
      const capText = (agent.capabilities ?? "").toLowerCase();
      let capMatchCount = 0;
      for (const kw of taskKeywords) {
        if (capText.includes(kw)) capMatchCount++;
      }

      // Composite score: capability match (strongest signal), then workload, then budget
      const score = (capMatchCount * 100) + budgetRemaining - (activeTasks * 50);

      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent;
      }
    }

    if (bestAgent) {
      this.db.prepare("update tasks set assignee_agent_id = ?, updated_at = ? where id = ?").run(bestAgent.id, nowIso(), taskId);
      this.addActivity({ companyId, actor: "system", action: "auto_assigned", entityType: "task", entityId: taskId, detail: `Auto-assigned to ${bestAgent.id} (score: ${bestScore})` });
      return bestAgent.id;
    }
    return null;
  }

  /* ─── Forward-Only Migration System ──────────────────────────────── */

  private runMigrations() {
    // Create migration tracking table
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
      // Migration 5 (convert_usd_to_cents) was removed: the runtime, shared types,
      // and renderer all treat monetary values as dollars. Converting stored data to
      // cents without updating every consumer would cause 100x display errors.
      // Dollar float values are sufficient for a local-first desktop app.
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

    this.db = this.openConnection();
    this.init();
  }

  // ── Inbox ──────────────────────────────────────────────────────────
  getInbox(companyId: string): InboxItem[] {
    const items: InboxItem[] = [];
    const snapshot = this.listSnapshot();
    const agents = snapshot.agents.filter(a => a.companyId === companyId);
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
        dismissed: false,
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
        dismissed: false,
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
        dismissed: false,
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
        dismissed: false,
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
        dismissed: false,
      });
    }

    // Sort by severity then date
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    items.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return items;
  }

  // ── Company Metrics ────────────────────────────────────────────────
  getCompanyMetrics(companyId: string, days: number = 30): CompanyMetrics {
    const snapshot = this.listSnapshot();
    const agents = snapshot.agents.filter(a => a.companyId === companyId);
    const tasks = snapshot.tasks.filter(t => t.companyId === companyId);
    const runs = snapshot.runs.filter(r => r.companyId === companyId);
    const costs = snapshot.costs.filter(c => c.companyId === companyId);

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

        // Review cycles: count tasks that went from in_review back to in_progress
        // Approximation: count activity entries with action "task.status_changed" and detail containing "in_progress"
        const reviewCycles = snapshot.activity.filter(
          a => a.companyId === companyId && a.actor === agent.id && a.action === "task.status_changed"
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

  // ── Standup Report ─────────────────────────────────────────────────
  getStandupReport(companyId: string): StandupReport {
    const snapshot = this.listSnapshot();
    const agents = snapshot.agents.filter(a => a.companyId === companyId && a.status !== "terminated" && a.status !== "pending_approval");
    const tasks = snapshot.tasks.filter(t => t.companyId === companyId);
    const runs = snapshot.runs.filter(r => r.companyId === companyId);
    const costs = snapshot.costs.filter(c => c.companyId === companyId);

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
      const reviewedTasks = recentActivity.filter(a => a.actor === agent.id && a.action.includes("status_changed")).length;
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
