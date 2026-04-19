import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type {
  ActivityRecord,
  AgentRecord,
  ApprovalRecord,
  CompanyRecord,
  CommentRecord,
  ConnectorRecord,
  CostRecord,
  GoalRecord,
  ProfileSnapshot,
  ProjectRecord,
  RunRecord,
  SecretRecord,
  TaskRecord,
  WorkspaceRecord,
} from "@shared/types";
import { BOARD_READER_ID, type ReadAll, type SqliteRow, toBoolean } from "./helpers";

export function buildSnapshotMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  deps: {
    getCurrentCompanyId: () => string | null;
    getSetting: (key: string) => string | null;
    readConnectors: () => ConnectorRecord[];
    profileDir: string;
    vaultBackendLabel: () => string;
  },
) {
  function listSnapshot(options: { companyId?: string | null } = {}): ProfileSnapshot {
    const companyId = options.companyId ?? null;
    const companyWhere = companyId ? " where company_id = ?" : "";
    const companyArgs: SQLInputValue[] = companyId ? [companyId] : [];
    const boardReadReceiptParams: SQLInputValue[] = companyId ? [BOARD_READER_ID, companyId] : [BOARD_READER_ID];
    const connectors = deps.readConnectors();
    const theme = (deps.getSetting("theme") as "system" | "light" | "dark" | null) ?? "system";
    const locale = (deps.getSetting("locale") as "en" | "zh" | null) ?? "en";
    const boardReadReceiptMap = new Map(
      readAll<{ messageId: string; readAt: string }>(
        `select reads.message_id as messageId, reads.read_at as readAt
           from agent_message_reads reads
           join agent_messages messages on messages.id = reads.message_id
          where reads.agent_id = ?${companyId ? " and messages.company_id = ?" : ""}`,
        ...boardReadReceiptParams,
      ).map((row) => [row.messageId, row.readAt]),
    );
    return {
      currentCompanyId: deps.getCurrentCompanyId(),
      profilePath: deps.profileDir,
      updatesEnabled: deps.getSetting("updates_enabled") !== "false",
      theme,
      locale,
      backend: {
        secretBackend: deps.vaultBackendLabel(),
      },
      companies: readAll<CompanyRecord>(
        "select id, name, description, status, auto_approve_hires as autoApproveHires, review_deliverables as reviewDeliverables, execution_mode as executionMode, created_at as createdAt, updated_at as updatedAt from companies order by created_at asc",
      ).map((record) => ({ ...record, autoApproveHires: toBoolean(record.autoApproveHires), reviewDeliverables: toBoolean(record.reviewDeliverables) })) as CompanyRecord[],
      connectors,
      workspaces: readAll<WorkspaceRecord>(
        `select id, company_id as companyId, name, local_path as localPath, repo_url as repoUrl, repo_ref as repoRef, project_id as projectId, state, is_primary as isPrimary, created_at as createdAt, updated_at as updatedAt from workspaces${companyWhere} order by created_at desc`,
        ...companyArgs,
      ).map((record) => ({ ...record, isPrimary: toBoolean(record.isPrimary) })) as WorkspaceRecord[],
      agents: readAll<SqliteRow>(
        `select id, company_id as companyId, name, role, title, department, status, reports_to as reportsTo, connector_id as connectorId, workspace_id as workspaceId, model, capabilities, role_level as roleLevel, model_strategy as modelStrategy, budget_monthly_usd as budgetMonthlyUsd, spent_monthly_usd as spentMonthlyUsd, metadata_json as metadataJson, heartbeat_enabled as heartbeatEnabled, heartbeat_interval_sec as heartbeatIntervalSec, last_heartbeat_at as lastHeartbeatAt, session_id as sessionId, created_at as createdAt, updated_at as updatedAt from agents${companyWhere} order by created_at asc`,
        ...companyArgs,
      ).map((record: SqliteRow) => ({ ...record, heartbeatEnabled: toBoolean(record.heartbeatEnabled) })) as AgentRecord[],
      goals: readAll<GoalRecord>(
        `select id, company_id as companyId, title, description, parent_id as parentId, owner_agent_id as ownerAgentId, status, created_at as createdAt, updated_at as updatedAt from goals${companyWhere} order by created_at asc`,
        ...companyArgs,
      ),
      projects: readAll<ProjectRecord>(
        `select id, company_id as companyId, goal_id as goalId, name, description, lead_agent_id as leadAgentId, status, target_date as targetDate, created_at as createdAt, updated_at as updatedAt from projects${companyWhere} order by created_at desc`,
        ...companyArgs,
      ),
      tasks: readAll<TaskRecord>(
        `select id, company_id as companyId, project_id as projectId, goal_id as goalId, parent_id as parentId, title, description, assignee_agent_id as assigneeAgentId, workspace_id as workspaceId, status, priority, active_run_id as activeRunId, session_json as sessionJson, session_display_id as sessionDisplayId, cost_usd as costUsd, task_type as taskType, requires_user_review as requiresUserReview, started_at as startedAt, completed_at as completedAt, cancelled_at as cancelledAt, created_at as createdAt, updated_at as updatedAt from tasks${companyWhere} order by created_at desc limit 2000`,
        ...companyArgs,
      ).map((record) => ({ ...record, requiresUserReview: toBoolean(record.requiresUserReview), startedAt: record.startedAt ?? null, completedAt: record.completedAt ?? null, cancelledAt: record.cancelledAt ?? null })) as TaskRecord[],
      approvals: readAll<ApprovalRecord>(
        `select id, company_id as companyId, related_task_id as relatedTaskId, related_agent_id as relatedAgentId, requested_by_agent_id as requestedByAgentId, type, payload_summary as payloadSummary, impact_summary as impactSummary, payload_json as payloadJson, decision_note as decisionNote, state, created_at as createdAt, updated_at as updatedAt from approvals${companyWhere} order by created_at desc limit 1000`,
        ...companyArgs,
      ),
      runs: readAll<RunRecord>(
        `select id, company_id as companyId, task_id as taskId, agent_id as agentId, workspace_id as workspaceId, connector_id as connectorId, status, summary, error_message as errorMessage, exit_code as exitCode, signal, model, session_display_id as sessionDisplayId, cost_usd as costUsd, unattributed_cost as unattributedCost, started_at as startedAt, finished_at as finishedAt, log_path as logPath, created_at as createdAt, updated_at as updatedAt from runs${companyWhere} order by created_at desc limit ${companyId ? 2000 : 2000}`,
        ...companyArgs,
      ).map((record) => ({ ...record, unattributedCost: Boolean(record.unattributedCost) })) as RunRecord[],
      costs: readAll<CostRecord>(
        `select id, company_id as companyId, run_id as runId, task_id as taskId, agent_id as agentId, connector_id as connectorId, amount_usd as amountUsd, unattributed, created_at as createdAt from cost_entries${companyWhere} order by created_at desc limit ${companyId ? 2000 : 2000}`,
        ...companyArgs,
      ).map((entry) => ({ ...entry, unattributed: Boolean(entry.unattributed) })) as CostRecord[],
      activity: readAll<ActivityRecord>(
        `select id, company_id as companyId, actor, action, entity_type as entityType, entity_id as entityId, detail, created_at as createdAt from activity${companyWhere} order by created_at desc limit ${companyId ? 1000 : 1000}`,
        ...companyArgs,
      ),
      secrets: readAll<SecretRecord>(
        `select id, company_id as companyId, name, description, backend, updated_at as updatedAt from secrets${companyWhere} order by updated_at desc`,
        ...companyArgs,
      ),
      comments: readAll<CommentRecord>(
        `select id, company_id as companyId, task_id as taskId, author_agent_id as authorAgentId, author_name as authorName, body, created_at as createdAt from task_comments${companyWhere} order by created_at asc`,
        ...companyArgs,
      ),
      socialAccounts: readAll<SqliteRow>(
        `select id, company_id, platform, account_name, display_name, profile_url, credential_secret_id, status, require_approval, metadata_json, last_used_at, created_at, updated_at from social_accounts${companyWhere} order by created_at desc`,
        ...companyArgs,
      ).map((r) => ({
        id: r.id, companyId: r.company_id, platform: r.platform, accountName: r.account_name,
        displayName: r.display_name, profileUrl: r.profile_url, credentialSecretId: r.credential_secret_id,
        status: r.status, requireApproval: toBoolean(r.require_approval), metadataJson: r.metadata_json,
        lastUsedAt: r.last_used_at, createdAt: r.created_at, updatedAt: r.updated_at,
      })),
      meetings: readAll<SqliteRow>(
        `select id, company_id, type, title, organizer_agent_id, participant_agent_ids, scheduled_at, duration_minutes, agenda_json, notes_json, decisions_json, action_items_json, status, created_at, updated_at from meetings${companyWhere} order by scheduled_at desc`,
        ...companyArgs,
      ).map((r) => ({
        id: r.id, companyId: r.company_id, type: r.type, title: r.title, organizerAgentId: r.organizer_agent_id,
        participantAgentIds: r.participant_agent_ids, scheduledAt: r.scheduled_at, durationMinutes: r.duration_minutes,
        agendaJson: r.agenda_json, notesJson: r.notes_json, decisionsJson: r.decisions_json,
        actionItemsJson: r.action_items_json, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
      })),
      documents: readAll<SqliteRow>(
        `select id, company_id, type, title, content, author_agent_id, reviewer_agent_id, project_id, goal_id, parent_doc_id, version, status, tags_json, latest_revision_id, created_at, updated_at from documents${companyWhere} order by updated_at desc`,
        ...companyArgs,
      ).map((r) => ({
        id: r.id, companyId: r.company_id, type: r.type, title: r.title, content: r.content,
        authorAgentId: r.author_agent_id, reviewerAgentId: r.reviewer_agent_id, projectId: r.project_id,
        goalId: r.goal_id, parentDocId: r.parent_doc_id, version: r.version, status: r.status,
        tagsJson: r.tags_json, latestRevisionId: r.latest_revision_id ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
      })),
      knowledgeBase: readAll<SqliteRow>(
        `select id, company_id, category, topic, content, author_agent_id, importance, tags_json, referenced_entity_type, referenced_entity_id, created_at, updated_at from knowledge_base${companyWhere} order by updated_at desc`,
        ...companyArgs,
      ).map((r) => ({
        id: r.id, companyId: r.company_id, category: r.category, topic: r.topic, content: r.content,
        authorAgentId: r.author_agent_id, importance: r.importance, tagsJson: r.tags_json,
        referencedEntityType: r.referenced_entity_type, referencedEntityId: r.referenced_entity_id,
        createdAt: r.created_at, updatedAt: r.updated_at,
      })),
      sprints: readAll<SqliteRow>(
        `select id, company_id, name, goal, start_date, end_date, status, retrospective_notes, velocity_points, completed_points, created_at, updated_at from sprints${companyWhere} order by start_date desc limit 500`,
        ...companyArgs,
      ).map((r) => ({
        id: r.id, companyId: r.company_id, name: r.name, goal: r.goal,
        startDate: r.start_date, endDate: r.end_date, status: r.status,
        retrospectiveNotes: r.retrospective_notes, velocityPoints: r.velocity_points,
        completedPoints: r.completed_points, createdAt: r.created_at, updatedAt: r.updated_at,
      })),
      automationRules: readAll<SqliteRow>(
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
      agentMessages: readAll<SqliteRow>(
        `select id, company_id, from_agent_id, to_agent_id, sender_kind, channel, channel_target_id, subject, body, priority, read_at, parent_message_id, attachments_json, created_at from agent_messages${companyWhere} order by created_at desc limit ${companyId ? 1000 : 1000}`,
        ...companyArgs,
      ).map((r) => ({
        id: r.id, companyId: r.company_id, fromAgentId: r.from_agent_id,
        toAgentId: r.to_agent_id, senderKind: r.sender_kind ?? "agent",
        channel: r.channel, channelTargetId: r.channel_target_id,
        subject: r.subject, body: r.body, priority: r.priority, readAt: boardReadReceiptMap.get(r.id) ?? null,
        parentMessageId: r.parent_message_id, attachmentsJson: r.attachments_json,
        createdAt: r.created_at,
      })),
      workflows: readAll<SqliteRow>(
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

  return {
    listSnapshot,

    listRendererSnapshot(): ProfileSnapshot {
      const currentCompanyId = deps.getCurrentCompanyId();
      return currentCompanyId
        ? listSnapshot({ companyId: currentCompanyId })
        : listSnapshot();
    },
  };
}
