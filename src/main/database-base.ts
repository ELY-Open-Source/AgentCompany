import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { buildThreadMethods } from "./database/threads";
import { buildCompanyMethods } from "./database/company";
import { buildAgentMethods } from "./database/agents";
import { buildTaskMethods } from "./database/tasks";
import { buildMessageMethods } from "./database/messages";
import { buildRunMethods } from "./database/runs";
import { buildSnapshotMethods } from "./database/snapshot";
import { buildSettingsMethods } from "./database/settings";
import { buildConnectorMethods } from "./database/connectors-crud";
import { buildWorkspaceMethods } from "./database/workspaces";
import { buildApprovalMethods } from "./database/approvals";
import { buildSocialMethods } from "./database/social";
import { buildActivityMethods } from "./database/activity";
import { buildSkillMethods } from "./database/skills";
import { buildBudgetMethods } from "./database/budget";
import { buildEntityCrudMethods } from "./database/entity-crud";
import { buildDocumentMethods } from "./database/documents";
import { buildAutomationMethods } from "./database/automation";
import { buildKnowledgeMethods } from "./database/knowledge";
import { buildWakeupMethods } from "./database/wakeup";
import { buildBackupMethods } from "./database/backup";
import { buildSessionEntryMethods } from "./database/session-entries";
import { buildCredentialMethods } from "./database/credentials";
import { initializeDatabase } from "./database/schema";
import { SecretVault } from "./vault";
import type { AgentStatus, ConnectorId, ProfileSnapshot, RunStatus } from "@shared/types";

function nowIso() {
  return new Date().toISOString();
}
export const STALE_LOCK_TIMEOUT_MS = 15 * 60 * 1000;

export class AppDatabaseBase {
  readonly profileDir: string;
  readonly dbPath: string;
  readonly logsDir: string;
  readonly artifactsDir: string;
  readonly backupsDir: string;
  readonly vault: SecretVault;
  protected db: DatabaseSync;

  // Domain modules. New code should prefer `db.tasks.saveTask(...)` over the
  // legacy pass-through methods on AppDatabase. Pass-through remains for
  // back-compat until all call sites migrate.
  public readonly threads: ReturnType<typeof buildThreadMethods>;
  public readonly company: ReturnType<typeof buildCompanyMethods>;
  public readonly agents: ReturnType<typeof buildAgentMethods>;
  public readonly tasks: ReturnType<typeof buildTaskMethods>;
  public readonly messages: ReturnType<typeof buildMessageMethods>;
  public readonly runs: ReturnType<typeof buildRunMethods>;
  public readonly snap: ReturnType<typeof buildSnapshotMethods>;
  public readonly settings: ReturnType<typeof buildSettingsMethods>;
  public readonly connectorsCrud: ReturnType<typeof buildConnectorMethods>;
  public readonly workspacesMod: ReturnType<typeof buildWorkspaceMethods>;
  public readonly approvalsMod: ReturnType<typeof buildApprovalMethods>;
  public readonly social: ReturnType<typeof buildSocialMethods>;
  public readonly activityMod: ReturnType<typeof buildActivityMethods>;
  public readonly skills: ReturnType<typeof buildSkillMethods>;
  public readonly budget: ReturnType<typeof buildBudgetMethods>;
  public readonly entityCrud: ReturnType<typeof buildEntityCrudMethods>;
  public readonly documentsMod: ReturnType<typeof buildDocumentMethods>;
  public readonly automationMod: ReturnType<typeof buildAutomationMethods>;
  public readonly knowledgeMod: ReturnType<typeof buildKnowledgeMethods>;
  public readonly wakeup: ReturnType<typeof buildWakeupMethods>;
  public readonly backupMod: ReturnType<typeof buildBackupMethods>;
  public readonly sessionEntries: ReturnType<typeof buildSessionEntryMethods>;
  public readonly credentialsTable: ReturnType<typeof buildCredentialMethods>;

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

    const getDb = () => this.db;
    const ra = <T>(sql: string, ...params: SQLInputValue[]) => this.readAll<T>(sql, ...params);
    const tx = <T>(op: () => T) => this.transaction(op);

    this.activityMod = buildActivityMethods(getDb, ra);
    this.settings = buildSettingsMethods(getDb, ra, {
      profileDir: this.profileDir, logsDir: this.logsDir,
      artifactsDir: this.artifactsDir, backupsDir: this.backupsDir,
    });
    this.connectorsCrud = buildConnectorMethods(getDb, ra);
    this.snap = buildSnapshotMethods(getDb, ra, {
      getCurrentCompanyId: () => this.settings.getCurrentCompanyId(),
      getSetting: (key) => this.getSetting(key),
      readConnectors: () => this.connectorsCrud.readConnectors(),
      profileDir: this.profileDir,
      vaultBackendLabel: () => this.vault.getBackendLabel(),
    });
    this.threads = buildThreadMethods(getDb, ra);
    this.company = buildCompanyMethods(getDb, ra, tx, {
      getSetting: (key) => this.getSetting(key),
      setSetting: (key, value) => this.setSetting(key, value),
      listSnapshot: (options) => this.listSnapshot(options),
      addComment: (input) => this.addComment(input),
    });
    this.agents = buildAgentMethods(getDb, ra, tx, {
      getAgent: (id) => this.getAgent(id),
      wouldCreateAgentCycle: (agentId, reportsTo) => this.wouldCreateAgentCycle(agentId, reportsTo),
      recordConfigRevision: (input) => this.recordConfigRevision(input),
      cancelRunForDeletion: (runId, taskId, workspaceId, summary) => this.runs.cancelRunForDeletion(runId, taskId, workspaceId, summary),
      addActivity: (input) => this.addActivity(input),
    });
    this.tasks = buildTaskMethods(getDb, ra, tx, {
      addComment: (input) => this.addComment(input),
      addActivity: (input) => this.addActivity(input),
    });
    this.messages = buildMessageMethods(getDb, ra, {
      getAgent: (id) => this.getAgent(id),
      addActivity: (input) => this.addActivity(input),
    });
    this.runs = buildRunMethods(getDb, ra, tx, { logsDir: this.logsDir });
    this.workspacesMod = buildWorkspaceMethods(getDb, ra, tx);
    this.approvalsMod = buildApprovalMethods(getDb, ra, tx, {
      getAgent: (id) => this.getAgent(id),
    });
    this.social = buildSocialMethods(getDb, ra, tx);
    this.skills = buildSkillMethods(getDb, ra);
    this.budget = buildBudgetMethods(getDb, ra, tx);
    this.entityCrud = buildEntityCrudMethods(getDb, ra, tx, {
      addActivity: (input) => this.addActivity(input),
    });
    this.documentsMod = buildDocumentMethods(getDb, ra, tx);
    this.automationMod = buildAutomationMethods(getDb, ra, {
      addActivity: (input) => this.addActivity(input),
    });
    this.knowledgeMod = buildKnowledgeMethods(getDb, ra);
    this.wakeup = buildWakeupMethods(getDb, ra, tx);
    this.sessionEntries = buildSessionEntryMethods(getDb, ra, tx);
    this.credentialsTable = buildCredentialMethods(getDb, ra, tx);
    this.backupMod = buildBackupMethods({
      getDb, setDb: (db) => { this.db = db; },
      openConnection: () => this.openConnection(),
      init: () => this.init(),
      close: () => this.close(),
      profileDir: this.profileDir, dbPath: this.dbPath,
      logsDir: this.logsDir, artifactsDir: this.artifactsDir,
      backupsDir: this.backupsDir,
    });
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  init() {
    const ra = <T>(sql: string, ...params: SQLInputValue[]) => this.readAll<T>(sql, ...params);
    const tx = <T>(op: () => T) => this.transaction(op);
    initializeDatabase(this.db, ra, tx);
    this.connectorsCrud.seedConnectors();
    this._lastInterruptedCount = this.interruptStaleRuns();
    this.settings.purgeExpiredRunLogs();
    this.wakeup.purgeExpiredWakeupRequests();
  }

  close() { this.db.close(); }

  // ─── Settings ──────────────────────────────────────────────────────────────

  getCurrentCompanyId() { return this.settings.getCurrentCompanyId(); }
  setCurrentCompany(companyId: string) { this.settings.setCurrentCompany(companyId); }
  hasCompany(companyId: string) { return this.settings.hasCompany(companyId); }
  belongsToCompany(table: "workspaces" | "agents" | "goals" | "projects" | "tasks" | "approvals" | "runs" | "secrets" | "meetings" | "documents" | "knowledge_base" | "sprints" | "automation_rules" | "workflow_pipelines", id: string, companyId: string) { return this.settings.belongsToCompany(table, id, companyId); }
  updateSettings(input: { theme?: "system" | "light" | "dark"; locale?: "en" | "zh"; updatesEnabled?: boolean; logRetentionDays?: number }) { this.settings.updateSettings(input); }
  getLogRetentionDays() { return this.settings.getLogRetentionDays(); }
  purgeExpiredRunLogs() { return this.settings.purgeExpiredRunLogs(); }
  canOpenPath(targetPath: string) { return this.settings.canOpenPath(targetPath); }
  getDisabledModels(connectorId: string) { return this.settings.getDisabledModels(connectorId); }
  setDisabledModels(connectorId: string, models: Array<{ id: string; label: string }>) { this.settings.setDisabledModels(connectorId, models); }
  hasModelPoolSettings(connectorId: string) { return this.settings.hasModelPoolSettings(connectorId); }
  getLastBudgetResetMonth(companyId: string) { return this.settings.getLastBudgetResetMonth(companyId); }
  setLastBudgetResetMonth(companyId: string, month: string) { this.settings.setLastBudgetResetMonth(companyId, month); }

  // ─── Snapshot ──────────────────────────────────────────────────────────────

  listSnapshot(options: { companyId?: string | null } = {}): ProfileSnapshot { return this.snap.listSnapshot(options); }
  listRendererSnapshot(): ProfileSnapshot { return this.snap.listRendererSnapshot(); }

  // ─── Company ───────────────────────────────────────────────────────────────

  saveCompany(input: { id?: string | null; name: string; description: string; status: string; autoApproveHires?: boolean; reviewDeliverables?: boolean; executionMode?: string }) { return this.company.saveCompany(input); }
  deleteCompany(id: string) { return this.company.deleteCompany(id); }
  getCompanyStatus(companyId: string) { return this.company.getCompanyStatus(companyId); }
  getCompanyBasic(companyId: string) { return this.company.getCompanyBasic(companyId); }
  getCompanyExecutionMode(companyId: string) { return this.company.getCompanyExecutionMode(companyId); }
  getCompanyApprovalSettings(companyId: string) { return this.company.getCompanyApprovalSettings(companyId); }
  listActiveCompanyIds() { return this.company.listActiveCompanyIds(); }
  getSidebarBadges(companyId: string) { return this.company.getSidebarBadges(companyId); }
  getInbox(companyId: string) { return this.company.getInbox(companyId); }
  getCompanyMetrics(companyId: string, days: number = 30) { return this.company.getCompanyMetrics(companyId, days); }
  getStandupReport(companyId: string) { return this.company.getStandupReport(companyId); }
  getDashboardSnapshot(companyId: string) { return this.company.getDashboardSnapshot(companyId); }

  // ─── Connectors ────────────────────────────────────────────────────────────

  saveConnector(input: { id: ConnectorId; command: string; model: string | null; envBindingText: string; notes: string }) { this.connectorsCrud.saveConnector(input); }
  updateConnectorHealth(input: { id: ConnectorId; status: string; authState: string; version: string | null; lastError: string | null }) { this.connectorsCrud.updateConnectorHealth(input); }
  getConnector(id: ConnectorId) { return this.connectorsCrud.getConnector(id); }
  findConnector(id: ConnectorId) { return this.connectorsCrud.findConnector(id); }

  // ─── Agents ────────────────────────────────────────────────────────────────

  saveAgent(input: { id?: string | null; companyId: string; name: string; role: string; title: string; department?: string | null; status: AgentStatus; reportsTo?: string | null; connectorId: ConnectorId; workspaceId?: string | null; model?: string | null; metadataJson?: string; capabilities: string; budgetMonthlyUsd: number }) { return this.agents.saveAgent(input); }
  deleteAgent(id: string, companyId: string) { return this.agents.deleteAgent(id, companyId); }
  getAgent(id: string) { return this.entityCrud.getAgent(id); }
  findAgent(id: string) { return this.entityCrud.findAgent(id); }
  setHeartbeat(agentId: string, enabled: boolean, intervalSec: number) { return this.agents.setHeartbeat(agentId, enabled, intervalSec); }
  markHeartbeatAt(agentId: string) { return this.agents.markHeartbeatAt(agentId); }
  resetMonthlyBudgets(companyId: string) { return this.agents.resetMonthlyBudgets(companyId); }
  listHeartbeatEligibleAgents(companyId: string) { return this.agents.listHeartbeatEligibleAgents(companyId); }
  getChainOfCommand(agentId: string) { return this.agents.getChainOfCommand(agentId); }
  getDirectReports(agentId: string, companyId: string) { return this.agents.getDirectReports(agentId, companyId); }
  getCeoForCompany(companyId: string) { return this.agents.getCeoForCompany(companyId); }
  listActiveAgentsForCompany(companyId: string) { return this.agents.listActiveAgentsForCompany(companyId); }
  listAgentsForApi(companyId: string) { return this.agents.listAgentsForApi(companyId); }
  listAgentsForStandup(companyId: string) { return this.agents.listAgentsForStandup(companyId); }
  listDirectReportsForStandup(companyId: string, managerId: string) { return this.agents.listDirectReportsForStandup(companyId, managerId); }
  listReportStatusesForStandup(companyId: string, managerId: string) { return this.agents.listReportStatusesForStandup(companyId, managerId); }
  listExistingAgentsForHireCheck(companyId: string) { return this.agents.listExistingAgentsForHireCheck(companyId); }
  hasAgentAssignedTasks(agentId: string, companyId: string) { return this.agents.hasAgentAssignedTasks(agentId, companyId); }
  updateAgentStatus(agentId: string, status: string) { return this.agents.updateAgentStatus(agentId, status); }
  isAgentPendingApproval(agentId: string) { return this.agents.isAgentPendingApproval(agentId); }
  findMentionedAgentIds(companyId: string, text: string) { return this.agents.findMentionedAgentIds(companyId, text); }
  getIdleAgentsForDepartment(companyId: string, department: string) { return this.agents.getIdleAgentsForDepartment(companyId, department); }
  getManagerForAgent(agentId: string) { return this.agents.getManagerForAgent(agentId); }
  getAgentPermissions(agentId: string) { return this.agents.getAgentPermissions(agentId); }
  setAgentPermission(agentId: string, companyId: string, permissionKey: string, enabled: boolean) { return this.agents.setAgentPermission(agentId, companyId, permissionKey, enabled); }
  hasAgentPermission(agentId: string, permissionKey: string) { return this.agents.hasAgentPermission(agentId, permissionKey); }
  getRuntimeState(agentId: string) { return this.agents.getRuntimeState(agentId); }
  setRuntimeState(agentId: string, companyId: string, state: Record<string, unknown>) { return this.agents.setRuntimeState(agentId, companyId, state); }
  getHeartbeatPolicy(agentId: string) { return this.agents.getHeartbeatPolicy(agentId); }
  setHeartbeatPolicy(agentId: string, companyId: string, policy: { enabled?: boolean; intervalSec?: number; cooldownSec?: number; maxConcurrentRuns?: number; wakeOnDemand?: boolean }) { return this.agents.setHeartbeatPolicy(agentId, companyId, policy); }
  countActiveRunsForAgent(agentId: string, companyId: string) { return this.agents.countActiveRunsForAgent(agentId, companyId); }

  // ─── Tasks ─────────────────────────────────────────────────────────────────

  saveTask(input: { id?: string | null; companyId: string; projectId?: string | null; goalId?: string | null; parentId?: string | null; title: string; description: string; assigneeAgentId?: string | null; workspaceId?: string | null; priority: string; status: string }) { return this.tasks.saveTask(input); }
  getTask(id: string) { return this.entityCrud.getTask(id); }
  deleteTask(id: string, companyId: string) { return this.tasks.deleteTask(id, companyId); }
  updateTaskSession(taskId: string, sessionJson: Record<string, unknown> | null, sessionDisplayId: string | null) { return this.tasks.updateTaskSession(taskId, sessionJson, sessionDisplayId); }
  getTaskSession(taskId: string) { return this.tasks.getTaskSession(taskId); }
  getActiveTaskSession(taskId: string) { return this.tasks.getActiveTaskSession(taskId); }
  incrementSessionUsage(sessionId: string, inputTokens: number, outputTokens: number, runId: string) { return this.tasks.incrementSessionUsage(sessionId, inputTokens, outputTokens, runId); }
  archiveSession(sessionId: string, reason: string, handoffMarkdown: string) { return this.tasks.archiveSession(sessionId, reason, handoffMarkdown); }
  createNewSession(input: { taskId: string; companyId: string; agentId: string; adapterType: string; sessionParamsJson: string | null; sessionDisplayId: string | null }) { return this.tasks.createNewSession(input); }
  getRecentRunsForTask(taskId: string, limit: number) { return this.tasks.getRecentRunsForTask(taskId, limit); }
  getRecentActivityForTask(taskId: string, limit: number) { return this.tasks.getRecentActivityForTask(taskId, limit); }
  checkoutTask(taskId: string, runId: string) { return this.tasks.checkoutTask(taskId, runId); }
  releaseTaskLock(taskId: string, runId: string) { return this.tasks.releaseTaskLock(taskId, runId); }
  renewTaskLease(taskId: string, runId: string) { return this.tasks.renewTaskLease(taskId, runId); }
  listAgentTasks(agentId: string, companyId: string, statuses: string[]) { return this.tasks.listAgentTasks(agentId, companyId, statuses); }
  listTasksByStatuses(companyId: string, statuses: string[]) { return this.tasks.listTasksByStatuses(companyId, statuses); }
  listTasksForStandup(companyId: string) { return this.tasks.listTasksForStandup(companyId); }
  listAssigneeTasksForStandup(companyId: string, agentId: string) { return this.tasks.listAssigneeTasksForStandup(companyId, agentId); }
  listTasksForAssignees(companyId: string, assigneeIds: string[]) { return this.tasks.listTasksForAssignees(companyId, assigneeIds); }
  findReusableHeartbeatTask(agentId: string, companyId: string) { return this.tasks.findReusableHeartbeatTask(agentId, companyId); }
  acquireHeartbeatTask(input: { agentId: string; companyId: string; runId: string; workspaceId: string | null; title: string; description: string; priority: string }) { return this.tasks.acquireHeartbeatTask(input); }
  cleanupDuplicateHeartbeatTasks(companyId: string) { return this.tasks.cleanupDuplicateHeartbeatTasks(companyId); }
  listReviewTasksForManager(managerId: string, companyId: string) { return this.tasks.listReviewTasksForManager(managerId, companyId); }
  countActiveTasksForCompany(companyId: string) { return this.tasks.countActiveTasksForCompany(companyId); }
  listChildTasks(parentId: string, companyId: string) { return this.tasks.listChildTasks(parentId, companyId); }
  advanceTaskStatus(taskId: string, newStatus: string, comment?: string) { return this.tasks.advanceTaskStatus(taskId, newStatus, comment); }
  setTaskRequiresUserReview(taskId: string, value: boolean) { return this.tasks.setTaskRequiresUserReview(taskId, value); }
  hasPendingDeliverableReviews(companyId: string) { return this.tasks.hasPendingDeliverableReviews(companyId); }
  hasAgentPendingDeliverableReview(agentId: string, companyId: string) { return this.tasks.hasAgentPendingDeliverableReview(agentId, companyId); }
  hasAgentTaskAwaitingReview(agentId: string, companyId: string) { return this.tasks.hasAgentTaskAwaitingReview(agentId, companyId); }
  autoAssignTask(taskId: string, companyId: string) { return this.tasks.autoAssignTask(taskId, companyId); }
  getTaskRetryCount(taskId: string) { return this.tasks.getTaskRetryCount(taskId); }
  incrementTaskRetryCount(taskId: string) { return this.tasks.incrementTaskRetryCount(taskId); }
  resetTaskRetryCount(taskId: string) { return this.tasks.resetTaskRetryCount(taskId); }
  retryInterruptedTask(taskId: string, _agentId: string, _companyId: string) { return this.tasks.retryInterruptedTask(taskId, _agentId, _companyId); }
  dismissInterruptedTask(taskId: string) { return this.tasks.dismissInterruptedTask(taskId); }
  markInterruptedTaskFailed(taskId: string) { return this.tasks.markInterruptedTaskFailed(taskId); }
  setTaskType(taskId: string, taskType: string) { return this.tasks.setTaskType(taskId, taskType); }

  // ─── Runs ──────────────────────────────────────────────────────────────────

  getRun(id: string) { return this.runs.getRun(id); }
  getRunAuthState(runId: string) { return this.runs.getRunAuthState(runId); }
  createRun(input: { id?: string; companyId: string; taskId: string; agentId: string; workspaceId: string | null; connectorId: ConnectorId }) { return this.runs.createRun(input); }
  appendRunLog(runId: string, stream: "stdout" | "stderr", chunk: string) { return this.runs.appendRunLog(runId, stream, chunk); }
  readRunLog(runId: string) { return this.runs.readRunLog(runId); }
  readRunLogChunk(runId: string, offset = 0, limit = 65_536) { return this.runs.readRunLogChunk(runId, offset, limit); }
  markRunStatus(runId: string, status: RunStatus, message: string) { return this.runs.markRunStatus(runId, status, message); }
  finishRun(input: { runId: string; status: RunStatus; summary: string | null; errorMessage: string | null; exitCode: number | null; signal: string | null; model: string | null; sessionDisplayId: string | null; costUsd: number | null; unattributedCost: boolean }) { return this.runs.finishRun(input); }
  hasActiveRun(filter: { companyId: string; taskId?: string; agentId?: string }) { return this.runs.hasActiveRun(filter); }
  listQueuedRuns() { return this.runs.listQueuedRuns(); }
  getInterruptedRunsForRecovery() { return this.runs.getInterruptedRunsForRecovery(); }
  appendRunEvent(input: { companyId: string; runId: string; agentId: string; eventType: string; stream?: string | null; level?: string | null; message?: string | null; payload?: Record<string, unknown> | null }) { return this.runs.appendRunEvent(input); }
  listRunEvents(runId: string, companyId: string, opts?: { offset?: number; limit?: number }) { return this.runs.listRunEvents(runId, companyId, opts); }
  listRunEventsAfter(runId: string, companyId: string, afterSeq: number, limit: number) { return this.runs.listRunEventsAfter(runId, companyId, afterSeq, limit); }
  updateRunActor(runId: string, actorType: string, actorId: string | null) { return this.runs.updateRunActor(runId, actorType, actorId); }

  // ─── Approvals ─────────────────────────────────────────────────────────────

  requestApproval(input: { companyId: string; relatedTaskId?: string | null; requestedByAgentId?: string | null; relatedAgentId?: string | null; type: string; payloadSummary: string; impactSummary: string; payloadJson?: string | null }) { return this.approvalsMod.requestApproval(input); }
  decideApproval(input: { companyId?: string | null; approvalId: string; state: string; decisionNote: string }) { return this.approvalsMod.decideApproval(input); }
  getApprovalRecord(id: string) { return this.approvalsMod.getApprovalRecord(id); }
  findApprovalById(id: string) { return this.approvalsMod.findApprovalById(id); }
  deleteApproval(id: string, companyId: string) { this.approvalsMod.deleteApproval(id, companyId); }
  getBlockingApproval(companyId: string, agentId: string, taskId: string | null) { return this.approvalsMod.getBlockingApproval(companyId, agentId, taskId); }
  resubmitApproval(approvalId: string, companyId: string) { this.approvalsMod.resubmitApproval(approvalId, companyId); }
  addApprovalComment(input: { companyId: string; approvalId: string; authorAgentId?: string | null; authorUserId?: string | null; body: string }) { return this.approvalsMod.addApprovalComment(input); }
  listApprovalComments(approvalId: string, companyId: string) { return this.approvalsMod.listApprovalComments(approvalId, companyId); }
  linkTaskToApproval(taskId: string, approvalId: string, companyId: string, linkedByAgentId?: string | null) { this.approvalsMod.linkTaskToApproval(taskId, approvalId, companyId, linkedByAgentId); }
  unlinkTaskFromApproval(taskId: string, approvalId: string) { this.approvalsMod.unlinkTaskFromApproval(taskId, approvalId); }
  listApprovalsForTask(taskId: string) { return this.approvalsMod.listApprovalsForTask(taskId); }
  listTasksForApproval(approvalId: string) { return this.approvalsMod.listTasksForApproval(approvalId); }
  linkManyTasksToApproval(approvalId: string, taskIds: string[], companyId: string, linkedByAgentId?: string | null) { this.approvalsMod.linkManyTasksToApproval(approvalId, taskIds, companyId, linkedByAgentId); }
  listApprovalsForStandup(companyId: string) { return this.approvalsMod.listApprovalsForStandup(companyId); }
  listAgentPendingApprovals(companyId: string, agentId: string) { return this.approvalsMod.listAgentPendingApprovals(companyId, agentId); }
  listAgentResolvedApprovals(companyId: string, agentId: string, limit?: number) { return this.approvalsMod.listAgentResolvedApprovals(companyId, agentId, limit); }
  listPendingHireApprovalPayloads(companyId: string) { return this.approvalsMod.listPendingHireApprovalPayloads(companyId); }
  listApprovalsForApi(companyId: string, filters: { requestedByAgentId?: string; relatedTaskId?: string; statuses?: string[] | null }) { return this.approvalsMod.listApprovalsForApi(companyId, filters); }

  // ─── Workspaces ────────────────────────────────────────────────────────────

  saveWorkspace(input: { id?: string | null; companyId: string; name: string; localPath: string; repoUrl: string; repoRef: string; projectId?: string | null; isPrimary: boolean }) { return this.workspacesMod.saveWorkspace(input); }
  getWorkspace(id: string | null | undefined) { return this.workspacesMod.getWorkspace(id); }
  getProjectPrimaryWorkspace(projectId: string | null | undefined, companyId: string) { return this.workspacesMod.getProjectPrimaryWorkspace(projectId, companyId); }
  listWorkspaceLocalPaths(companyId: string) { return this.workspacesMod.listWorkspaceLocalPaths(companyId); }
  getAnyCompanyWorkspace(companyId: string) { return this.workspacesMod.getAnyCompanyWorkspace(companyId); }
  deleteWorkspace(id: string, companyId: string) { this.workspacesMod.deleteWorkspace(id, companyId); }
  acquireWorkspaceLock(workspaceId: string, runId: string) { return this.workspacesMod.acquireWorkspaceLock(workspaceId, runId); }
  claimWorkspaceLock(workspaceId: string, runId: string) { return this.workspacesMod.claimWorkspaceLock(workspaceId, runId); }
  releaseWorkspaceLock(workspaceId: string, runId: string) { this.workspacesMod.releaseWorkspaceLock(workspaceId, runId); }
  releaseAllWorkspaceLocks() { this.workspacesMod.releaseAllWorkspaceLocks(); }
  releaseStaleWorkspaceLocks() { return this.workspacesMod.releaseStaleWorkspaceLocks(); }
  isWorkspaceLocked(workspaceId: string) { return this.workspacesMod.isWorkspaceLocked(workspaceId); }

  // ─── Internal infrastructure ───────────────────────────────────────────────
  protected _lastInterruptedCount = 0;
  get lastInterruptedCount(): number { return this._lastInterruptedCount; }

  interruptStaleRuns(): number {
    const ts = nowIso();
    let interruptedCount = 0;
    this.transaction(() => {
      const result = this.db
        .prepare("update runs set status = 'interrupted', error_message = 'AgentCompany restarted before the run could report completion.', finished_at = ?, updated_at = ? where status = 'running'")
        .run(ts, ts);
      interruptedCount = Number(result.changes);
      if (interruptedCount > 0) {
        this.db.prepare(
          `update tasks set status = 'blocked', updated_at = ? where id in (select task_id from runs where status = 'interrupted' and finished_at = ?) and status in ('in_progress', 'todo')`,
        ).run(ts, ts);
      }
      this.db.prepare("update tasks set active_run_id = null where active_run_id in (select id from runs where status = 'interrupted')").run();
      this.db.prepare("update agents set status = 'idle', updated_at = ? where status = 'running'").run(ts);
      this.releaseAllWorkspaceLocks();
    });
    return interruptedCount;
  }

  recoverStaleLocks(): Array<{ taskId: string; companyId: string; title: string }> {
    const cutoff = new Date(Date.now() - STALE_LOCK_TIMEOUT_MS).toISOString();
    const stale = this.readAll<{ id: string; companyId: string; title: string }>(
      `SELECT id, company_id AS companyId, title FROM tasks WHERE execution_locked_at IS NOT NULL AND execution_locked_at < ? AND status = 'in_progress' AND checkout_run_id NOT IN (SELECT id FROM runs WHERE status = 'running')`,
      cutoff,
    );
    const ts = nowIso();
    for (const task of stale) {
      this.db.prepare(`UPDATE tasks SET checkout_run_id = NULL, execution_locked_at = NULL, status = 'todo', updated_at = ? WHERE id = ?`).run(ts, task.id);
    }
    return stale.map((t) => ({ taskId: t.id, companyId: t.companyId, title: t.title }));
  }

  protected incrementActiveSprintVelocity(companyId: string, delta: number) {
    this.entityCrud.incrementActiveSprintVelocity(companyId, delta);
  }

  protected getSetting(key: string): string | null {
    const row = this.db.prepare("select value from settings where key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  protected setSetting(key: string, value: string) {
    this.db.prepare("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value").run(key, value);
  }

  protected readAll<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  protected wouldCreateAgentCycle(agentId: string, reportsTo: string | null) {
    if (!reportsTo) return false;
    if (reportsTo === agentId) return true;
    const visited = new Set<string>([agentId]);
    let currentId: string | null = reportsTo;
    while (currentId) {
      if (visited.has(currentId)) return true;
      visited.add(currentId);
      const current = this.db.prepare("select reports_to as reportsTo from agents where id = ?").get(currentId) as { reportsTo: string | null } | undefined;
      currentId = current?.reportsTo ?? null;
    }
    return false;
  }

  protected openConnection(): DatabaseSync {
    const db = new DatabaseSync(this.dbPath, { timeout: 5000 });
    db.exec("pragma journal_mode = WAL;");
    db.exec("pragma busy_timeout = 5000;");
    db.exec("pragma synchronous = NORMAL;");
    db.exec("pragma foreign_keys = ON;");
    return db;
  }

  protected transaction<T>(operation: () => T): T {
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

  // ─── Methods used by subclass constructor callbacks ────────────────────────

  addActivity(input: { companyId: string; actor: string; action: string; entityType: string; entityId: string; detail: string }) { this.activityMod.addActivity(input); }
  addComment(input: { companyId: string; taskId: string; authorAgentId: string | null; authorName: string; body: string }) { return this.activityMod.addComment(input); }
  listRecentTaskComments(taskIds: string[], sinceIso: string, limit: number) { return this.activityMod.listRecentTaskComments(taskIds, sinceIso, limit); }
  recordConfigRevision(input: { companyId: string; agentId: string; changedKeys: string[]; configBefore: Record<string, unknown>; configAfter: Record<string, unknown>; source?: string; rolledBackFromRevisionId?: string | null; createdByAgentId?: string | null; createdByUserId?: string | null }) { return this.documentsMod.recordConfigRevision(input); }
}
