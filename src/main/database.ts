import type { SQLInputValue } from "node:sqlite";
import { AppDatabaseBase } from "./database-base";
import { listInvalidEnvBindingKeys, parseEnvBindingText } from "./connectors";
import type { ConnectorId, WorkflowPipelineRecord } from "@shared/types";
import type { buildThreadMethods } from "./database/threads";

export { STALE_LOCK_TIMEOUT_MS } from "./database-base";

export class AppDatabase extends AppDatabaseBase {

  // ─── Activity & Comments ───────────────────────────────────────────────────

  listComments(taskId: string) { return this.activityMod.listComments(taskId); }

  // ─── Messages ──────────────────────────────────────────────────────────────

  sendAgentMessage(input: { companyId: string; fromAgentId: string; toAgentId?: string | null; channel?: string; channelTargetId?: string | null; subject: string; body: string; priority?: string; parentMessageId?: string | null; attachmentsJson?: string; senderKind?: "agent" | "human" | "system" }) { return this.messages.sendAgentMessage(input); }
  getAgentMessage(messageId: string, companyId: string) { return this.messages.getAgentMessage(messageId, companyId); }
  listAgentMessages(companyId: string, opts?: { agentId?: string; messageId?: string; channel?: string; channelTargetId?: string | null; unreadOnly?: boolean; limit?: number }) { return this.messages.listAgentMessages(companyId, opts); }
  searchMessages(companyId: string, query: string, opts?: { channel?: string; channelTargetId?: string | null; limit?: number }) { return this.messages.searchMessages(companyId, query, opts); }
  markMessageReadForReader(messageId: string, companyId: string, readerAgentId?: string | null) { return this.messages.markMessageReadForReader(messageId, companyId, readerAgentId); }
  listAgentInboxUnread(companyId: string, agentId: string) { return this.messages.listAgentInboxUnread(companyId, agentId); }

  // ─── Social & Browser Actions ──────────────────────────────────────────────

  saveSocialAccount(input: { id?: string | null; companyId: string; platform: string; accountName: string; displayName?: string; profileUrl?: string; credentialSecretId?: string | null; status?: string; requireApproval?: boolean; metadataJson?: string }) { return this.social.saveSocialAccount(input); }
  deleteSocialAccount(id: string, companyId: string) { this.social.deleteSocialAccount(id, companyId); }
  listSocialAccounts(companyId: string) { return this.social.listSocialAccounts(companyId); }
  getSocialAccount(id: string, companyId: string) { return this.social.getSocialAccount(id, companyId); }
  saveBrowserAction(input: { companyId: string; socialAccountId: string; agentId: string; taskId?: string | null; actionType: string; payloadJson: string; status?: string; approvalId?: string | null }) { return this.social.saveBrowserAction(input); }
  updateBrowserAction(id: string, updates: { status?: string; resultSummary?: string; screenshotPath?: string | null; errorMessage?: string | null; startedAt?: string; finishedAt?: string }) { this.social.updateBrowserAction(id, updates); }
  listBrowserActions(companyId: string, filters?: { socialAccountId?: string; status?: string; limit?: number }) { return this.social.listBrowserActions(companyId, filters); }
  getBrowserAction(id: string, companyId: string) { return this.social.getBrowserAction(id, companyId); }
  getBrowserActionByApprovalId(approvalId: string, companyId: string) { return this.social.getBrowserActionByApprovalId(approvalId, companyId); }

  // ─── Skills ────────────────────────────────────────────────────────────────

  upsertCompanySkill(skill: { id: string; companyId: string; key: string; slug: string; name: string; description: string | null; sourceType: string; sourceLocator: string | null; sourceRef: string | null; trustLevel: string; compatibility: string; fileInventory: string; metadata: string | null; createdAt: string; updatedAt: string }) { return this.skills.upsertCompanySkill(skill); }
  listCompanySkills(companyId: string) { return this.skills.listCompanySkills(companyId); }
  getCompanySkill(companyId: string, skillId: string) { return this.skills.getCompanySkill(companyId, skillId); }
  deleteCompanySkill(companyId: string, skillId: string) { return this.skills.deleteCompanySkill(companyId, skillId); }
  assignSkillToAgent(agentId: string, skillId: string) { this.skills.assignSkillToAgent(agentId, skillId); }
  removeSkillFromAgent(agentId: string, skillId: string) { this.skills.removeSkillFromAgent(agentId, skillId); }
  listAgentSkillAssignments(agentId: string) { return this.skills.listAgentSkillAssignments(agentId); }
  listSkillAgentAssignments(skillId: string) { return this.skills.listSkillAgentAssignments(skillId); }
  updateCompanySkillMetadata(companyId: string, skillId: string, metadataJson: string) { this.skills.updateCompanySkillMetadata(companyId, skillId, metadataJson); }

  // ─── Budget ────────────────────────────────────────────────────────────────

  saveBudgetPolicy(input: { id?: string | null; companyId: string; scopeType: string; scopeId: string; metric?: string; windowKind?: string; amount: number; warnPercent?: number; hardStopEnabled?: boolean; notifyEnabled?: boolean; isActive?: boolean }) { return this.budget.saveBudgetPolicy(input); }
  deleteBudgetPolicy(companyId: string, policyId: string) { this.budget.deleteBudgetPolicy(companyId, policyId); }
  listBudgetPolicies(companyId: string) { return this.budget.listBudgetPolicies(companyId); }
  getBudgetPolicy(policyId: string) { return this.budget.getBudgetPolicy(policyId); }
  getActivePoliciesForRun(companyId: string, agentId: string, projectId: string | null) { return this.budget.getActivePoliciesForRun(companyId, agentId, projectId); }
  getCalendarMonthWindow() { return this.budget.getCalendarMonthWindow(); }
  getSpentInWindow(policy: Parameters<typeof this.budget.getSpentInWindow>[0]) { return this.budget.getSpentInWindow(policy); }
  upsertBudgetIncident(policy: Parameters<typeof this.budget.upsertBudgetIncident>[0], thresholdType: "warn_threshold" | "hard_stop", amountObserved: number) { return this.budget.upsertBudgetIncident(policy, thresholdType, amountObserved); }
  listBudgetIncidents(companyId: string, statusFilter: string = "all") { return this.budget.listBudgetIncidents(companyId, statusFilter); }
  resolveBudgetIncident(incidentId: string, companyId: string) { this.budget.resolveBudgetIncident(incidentId, companyId); }
  resolveIncidentsForPolicy(policyId: string, resolutionStatus: string) { return this.budget.resolveIncidentsForPolicy(policyId, resolutionStatus); }
  resolveWarnIncidentsForPolicy(policyId: string, resolutionStatus: string) { return this.budget.resolveWarnIncidentsForPolicy(policyId, resolutionStatus); }
  autoCloseExpiredIncidents(companyId: string) { return this.budget.autoCloseExpiredIncidents(companyId); }

  // ─── Entity CRUD ───────────────────────────────────────────────────────────

  saveGoal(input: { id?: string | null; companyId: string; title: string; description: string; parentId?: string | null; ownerAgentId?: string | null; status: string }) { return this.entityCrud.saveGoal(input); }
  listGoals(companyId: string) { return this.entityCrud.listGoals(companyId); }
  getGoalForUpdate(goalId: string, companyId: string) { return this.entityCrud.getGoalForUpdate(goalId, companyId); }
  saveProject(input: { id?: string | null; companyId: string; goalId?: string | null; name: string; description: string; leadAgentId?: string | null; targetDate?: string | null; status: string }) { return this.entityCrud.saveProject(input); }
  listProjects(companyId: string) { return this.entityCrud.listProjects(companyId); }
  getProjectForUpdate(projectId: string, companyId: string) { return this.entityCrud.getProjectForUpdate(projectId, companyId); }
  saveSecret(input: { id?: string | null; companyId: string; name: string; description: string; value: string }) { return this.entityCrud.saveSecret(input, this.vault); }
  resolveSecretEnv(bindingText: string, companyId: string) { return this.entityCrud.resolveSecretEnv(bindingText, companyId, this.vault, listInvalidEnvBindingKeys, parseEnvBindingText); }
  deleteGoal(id: string, companyId: string) { this.entityCrud.deleteGoal(id, companyId); }
  deleteProject(id: string, companyId: string) { this.entityCrud.deleteProject(id, companyId); }
  deleteSecret(id: string, companyId: string) { this.entityCrud.deleteSecret(id, companyId); }
  countActiveGoalsForCompany(companyId: string) { return this.entityCrud.countActiveGoalsForCompany(companyId); }
  createHireRequest(input: { companyId: string; requestedByAgentId?: string | null; name: string; role: string; title: string; department?: string | null; reportsTo?: string | null; connectorId: ConnectorId; workspaceId?: string | null; model?: string | null; metadataJson?: string; capabilities: string; budgetMonthlyUsd: number; payloadSummary: string; impactSummary: string; payloadJson?: string | null }) {
    return this.entityCrud.createHireRequest(input, {
      saveAgent: (agentInput) => this.saveAgent(agentInput),
      requestApproval: (approvalInput) => this.requestApproval(approvalInput),
    });
  }

  // ─── Documents & Work Products ─────────────────────────────────────────────

  saveDocument(input: { id?: string | null; companyId: string; type: string; title: string; content?: string; authorAgentId?: string | null; reviewerAgentId?: string | null; projectId?: string | null; goalId?: string | null; parentDocId?: string | null; version?: number; status?: string; tagsJson?: string; sourceRunId?: string | null }) { return this.documentsMod.saveDocument(input); }
  listImportantDocsForReview(input: { companyId: string; types: readonly string[]; authorAgentId: string | null; taskId: string; limit?: number }) { return this.documentsMod.listImportantDocsForReview(input); }
  listDocuments(companyId: string) { return this.documentsMod.listDocuments(companyId); }
  getDocumentForUpdate(documentId: string, companyId: string) { return this.documentsMod.getDocumentForUpdate(documentId, companyId); }
  updateDocumentStatus(id: string, companyId: string, status: string) { this.documentsMod.updateDocumentStatus(id, companyId, status); }
  deleteDocument(id: string, companyId: string) { this.documentsMod.deleteDocument(id, companyId); }
  createDocumentRevision(input: { documentId: string; companyId: string; body: string; changeSummary?: string | null; createdByAgentId?: string | null; createdByUserId?: string | null }) { return this.documentsMod.createDocumentRevision(input); }
  getDocumentLatestRevisionId(documentId: string) { return this.documentsMod.getDocumentLatestRevisionId(documentId); }
  listDocumentRevisions(documentId: string, companyId: string) { return this.documentsMod.listDocumentRevisions(documentId, companyId); }
  createWorkProduct(input: { companyId: string; taskId: string | null; projectId?: string | null; workspaceId?: string | null; type: string; provider: string; externalId?: string | null; title: string; url?: string | null; status?: string; reviewState?: string; isPrimary?: boolean; summary?: string | null; metadataJson?: string | null; createdByRunId?: string | null }) { return this.documentsMod.createWorkProduct(input); }
  updateWorkProduct(id: string, companyId: string, patch: Parameters<ReturnType<typeof import("./database/documents").buildDocumentMethods>["updateWorkProduct"]>[2]) { return this.documentsMod.updateWorkProduct(id, companyId, patch); }
  listWorkProductsForTask(taskId: string, companyId: string) { return this.documentsMod.listWorkProductsForTask(taskId, companyId); }
  findWorkProductByExternalId(companyId: string, provider: string, externalId: string, workspaceId: string | null) { return this.documentsMod.findWorkProductByExternalId(companyId, provider, externalId, workspaceId); }
  resolveWorkProductTarget(workProductId: string, companyId: string) { return this.documentsMod.resolveWorkProductTarget(workProductId, companyId); }
  deleteWorkProduct(id: string, companyId: string) { return this.documentsMod.deleteWorkProduct(id, companyId); }
  archiveWorkProductsByExternalPaths(input: Parameters<ReturnType<typeof import("./database/documents").buildDocumentMethods>["archiveWorkProductsByExternalPaths"]>[0]) {
    return this.documentsMod.archiveWorkProductsByExternalPaths(input);
  }
  linkDocumentToTask(taskId: string, documentId: string, companyId: string, key: string) { return this.documentsMod.linkDocumentToTask(taskId, documentId, companyId, key); }
  unlinkDocumentFromTask(taskId: string, key: string, companyId: string) { this.documentsMod.unlinkDocumentFromTask(taskId, key, companyId); }
  listDocumentsForTask(taskId: string, companyId: string) { return this.documentsMod.listDocumentsForTask(taskId, companyId); }
  listConfigRevisions(agentId: string, companyId: string) { return this.documentsMod.listConfigRevisions(agentId, companyId); }
  getConfigRevision(revisionId: string, companyId: string) { return this.documentsMod.getConfigRevision(revisionId, companyId); }
  rollbackConfigRevision(agentId: string, revisionId: string, companyId: string) {
    return this.documentsMod.rollbackConfigRevision(agentId, revisionId, companyId, {
      getConfigRevision: (rid, cid) => this.getConfigRevision(rid, cid),
      getAgent: (id) => this.getAgent(id),
      recordConfigRevision: (input) => this.recordConfigRevision(input),
    });
  }

  // ─── Knowledge ─────────────────────────────────────────────────────────────

  saveMeeting(input: { id?: string | null; companyId: string; type: string; title: string; organizerAgentId?: string | null; participantAgentIds?: string; scheduledAt: string; durationMinutes?: number; agendaJson?: string; notesJson?: string; decisionsJson?: string; actionItemsJson?: string; status?: string }) { return this.knowledgeMod.saveMeeting(input); }
  deleteMeeting(id: string, companyId: string) { this.knowledgeMod.deleteMeeting(id, companyId); }
  listMeetings(companyId: string) { return this.knowledgeMod.listMeetings(companyId); }
  getMeeting(meetingId: string, companyId: string) { return this.knowledgeMod.getMeeting(meetingId, companyId); }
  saveKnowledgeEntry(input: { id?: string | null; companyId: string; category: string; topic: string; content: string; authorAgentId?: string | null; importance?: string; tagsJson?: string; referencedEntityType?: string | null; referencedEntityId?: string | null; sourceRunId?: string | null }) { return this.knowledgeMod.saveKnowledgeEntry(input); }
  deleteKnowledgeEntry(id: string, companyId: string) { this.knowledgeMod.deleteKnowledgeEntry(id, companyId); }
  listKnowledgeEntries(companyId: string) { return this.knowledgeMod.listKnowledgeEntries(companyId); }
  saveSprint(input: { id?: string | null; companyId: string; name: string; goal?: string; startDate: string; endDate: string; status?: string; retrospectiveNotes?: string; velocityPoints?: number; completedPoints?: number }) { return this.knowledgeMod.saveSprint(input); }
  deleteSprint(id: string, companyId: string) { this.knowledgeMod.deleteSprint(id, companyId); }
  listSprints(companyId: string) { return this.knowledgeMod.listSprints(companyId); }
  collectRunDeliverableSignals(runId: string, companyId: string, taskId: string) {
    return this.knowledgeMod.collectRunDeliverableSignals(runId, companyId, taskId);
  }

  // ─── Automation ────────────────────────────────────────────────────────────

  saveAutomationRule(input: { id?: string | null; companyId: string; name: string; description?: string; trigger: string; conditionsJson?: string; action: string; actionConfigJson?: string; sourceDepartment?: string | null; targetDepartment?: string | null; priority?: number; status?: string }) { return this.automationMod.saveAutomationRule(input); }
  deleteAutomationRule(id: string, companyId: string) { this.automationMod.deleteAutomationRule(id, companyId); }
  listAutomationRuleNames(companyId: string) { return this.automationMod.listAutomationRuleNames(companyId); }
  toggleAutomationRule(id: string, companyId: string, status: "active" | "paused") { this.automationMod.toggleAutomationRule(id, companyId, status); }
  recordAutomationExecution(ruleId: string, companyId: string, ruleName: string, trigger: string, action: string, detail: string) { this.automationMod.recordAutomationExecution(ruleId, companyId, ruleName, trigger, action, detail); }
  getAutomationLog(companyId: string) { return this.automationMod.getAutomationLog(companyId); }
  listActiveAutomationRules(companyId: string, trigger: string) { return this.automationMod.listActiveAutomationRules(companyId, trigger); }
  saveWorkflow(input: { id?: string | null; companyId: string; name: string; description?: string; stepsJson?: string; triggerType: string; triggerConfigJson?: string; status?: string }) { return this.automationMod.saveWorkflow(input); }
  getWorkflowRecord(id: string, companyId: string) { return this.automationMod.getWorkflowRecord(id, companyId); }
  updateWorkflowExecution(input: { id: string; companyId: string; status: string; currentStepIndex: number; stepsJson: string; incrementRunCount?: boolean; lastRunAt?: string | null }) { this.automationMod.updateWorkflowExecution(input); }
  deleteWorkflow(id: string, companyId: string) { this.automationMod.deleteWorkflow(id, companyId); }
  listTriggerableWorkflows(companyId: string, triggerType: string): WorkflowPipelineRecord[] { return this.automationMod.listTriggerableWorkflows(companyId, triggerType); }

  // ─── Wakeup ────────────────────────────────────────────────────────────────

  enqueueWakeupRequest(companyId: string, agentId: string, trigger: string, detail: string, context?: Record<string, unknown>) { this.wakeup.enqueueWakeupRequest(companyId, agentId, trigger, detail, context); }
  promoteWakeupRequests(agentId: string, companyId: string) { return this.wakeup.promoteWakeupRequests(agentId, companyId); }
  listWakeupRequests(companyId: string, filters?: { status?: string; agentId?: string; limit?: number }) { return this.wakeup.listWakeupRequests(companyId, filters); }
  getPreferredWakeTrigger(agentId: string, companyId: string) { return this.wakeup.getPreferredWakeTrigger(agentId, companyId); }
  completePendingWakeupRequests(agentId: string, companyId: string, runId: string) { return this.wakeup.completePendingWakeupRequests(agentId, companyId, runId); }
  purgeExpiredWakeupRequests() { return this.wakeup.purgeExpiredWakeupRequests(); }

  // ─── Backup ────────────────────────────────────────────────────────────────

  exportBackup(targetDir: string) { return this.backupMod.exportBackup(targetDir); }
  async restoreFromBackup(sourceDir: string) { return this.backupMod.restoreFromBackup(sourceDir); }

  // ─── Thread Runtime ────────────────────────────────────────────────────────

  createThread(input: Parameters<ReturnType<typeof buildThreadMethods>["createThread"]>[0]) { return this.threads.createThread(input); }
  listThreads(options: Parameters<ReturnType<typeof buildThreadMethods>["listThreads"]>[0]) { return this.threads.listThreads(options); }
  getThread(threadId: string, companyId: string) { return this.threads.getThread(threadId, companyId); }
  addThreadEvent(input: Parameters<ReturnType<typeof buildThreadMethods>["addThreadEvent"]>[0]) { return this.threads.addThreadEvent(input); }
  listThreadEvents(threadId: string, companyId: string, options?: Parameters<ReturnType<typeof buildThreadMethods>["listThreadEvents"]>[2]) { return this.threads.listThreadEvents(threadId, companyId, options); }
  setThreadWaitState(input: Parameters<ReturnType<typeof buildThreadMethods>["setThreadWaitState"]>[0]) { return this.threads.setThreadWaitState(input); }
  resolveThreadWaitState(waitStateId: string, companyId: string) { return this.threads.resolveThreadWaitState(waitStateId, companyId); }
  listThreadWaitStates(companyId: string, options?: Parameters<ReturnType<typeof buildThreadMethods>["listThreadWaitStates"]>[1]) { return this.threads.listThreadWaitStates(companyId, options); }
  hasUnresolvedWaitStateForAgent(companyId: string, agentId: string) { return this.threads.hasUnresolvedWaitStateForAgent(companyId, agentId); }
  addParticipant(input: Parameters<ReturnType<typeof buildThreadMethods>["addParticipant"]>[0]) { return this.threads.addParticipant(input); }
  listParticipants(threadId: string) { return this.threads.listParticipants(threadId); }
  removeParticipant(threadId: string, participantId: string) { return this.threads.removeParticipant(threadId, participantId); }
  subscribe(input: Parameters<ReturnType<typeof buildThreadMethods>["subscribe"]>[0]) { return this.threads.subscribe(input); }
  unsubscribe(threadId: string, subscriberId: string) { return this.threads.unsubscribe(threadId, subscriberId); }
  listSubscriptions(threadId: string) { return this.threads.listSubscriptions(threadId); }
  listSubscribedThreads(subscriberId: string, companyId: string) { return this.threads.listSubscribedThreads(subscriberId, companyId); }

  // ─── Internal raw-SQL escape hatch ────────────────────────────────────────
  //
  // Not part of the public API. New callers MUST add a typed method on the
  // appropriate `database/<module>.ts` and route through there. The existing
  // call sites remain only to avoid a repo-wide migration; see
  // `.planning/review2/02-persistence-ipc.md` DB-001 for the migration list.

  /** @internal */
  queryAll<T>(sql: string, ...params: SQLInputValue[]): T[] { return this.readAll<T>(sql, ...params); }
}
