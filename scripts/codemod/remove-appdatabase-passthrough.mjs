#!/usr/bin/env node
/**
 * Codemod: rewrite `db.<passthroughMethod>(` → `db.<module>.<passthroughMethod>(`
 * for all AppDatabase pass-through methods removed by the C1 refactor.
 *
 * Regex-based (no ts-morph dep). Operates on a fixed method→module map
 * derived mechanically from src/main/database.ts and
 * src/main/database-base.ts. Only rewrites `db.<method>(...)` with a
 * word-boundary before `db`; never touches `db.<submodule>.<method>(...)`.
 *
 * Usage:
 *   node scripts/codemod/remove-appdatabase-passthrough.mjs \
 *     --modules=tasks,agents \
 *     [--dry-run]
 *
 * The --modules flag restricts rewrites to passthroughs owned by those
 * sub-module fields; omitting it rewrites every passthrough in the map.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { globSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

// Canonical map: passthrough method name → AppDatabaseBase field name
// Source: src/main/database.ts + src/main/database-base.ts as of C1 start.
const METHOD_TO_MODULE = {
  // activityMod
  listComments: "activityMod",
  addActivity: "activityMod",
  addComment: "activityMod",
  listRecentTaskComments: "activityMod",
  // messages
  sendAgentMessage: "messages",
  getAgentMessage: "messages",
  listAgentMessages: "messages",
  searchMessages: "messages",
  markMessageReadForReader: "messages",
  listAgentInboxUnread: "messages",
  // social
  saveSocialAccount: "social",
  deleteSocialAccount: "social",
  listSocialAccounts: "social",
  getSocialAccount: "social",
  saveBrowserAction: "social",
  updateBrowserAction: "social",
  listBrowserActions: "social",
  getBrowserAction: "social",
  getBrowserActionByApprovalId: "social",
  // skills
  upsertCompanySkill: "skills",
  listCompanySkills: "skills",
  getCompanySkill: "skills",
  deleteCompanySkill: "skills",
  assignSkillToAgent: "skills",
  removeSkillFromAgent: "skills",
  listAgentSkillAssignments: "skills",
  listSkillAgentAssignments: "skills",
  updateCompanySkillMetadata: "skills",
  // budget
  saveBudgetPolicy: "budget",
  deleteBudgetPolicy: "budget",
  listBudgetPolicies: "budget",
  getBudgetPolicy: "budget",
  getActivePoliciesForRun: "budget",
  getCalendarMonthWindow: "budget",
  getSpentInWindow: "budget",
  upsertBudgetIncident: "budget",
  listBudgetIncidents: "budget",
  resolveBudgetIncident: "budget",
  resolveIncidentsForPolicy: "budget",
  resolveWarnIncidentsForPolicy: "budget",
  autoCloseExpiredIncidents: "budget",
  // entityCrud
  saveGoal: "entityCrud",
  listGoals: "entityCrud",
  getGoalForUpdate: "entityCrud",
  saveProject: "entityCrud",
  listProjects: "entityCrud",
  getProjectForUpdate: "entityCrud",
  saveSecret: "entityCrud",
  resolveSecretEnv: "entityCrud",
  deleteGoal: "entityCrud",
  deleteProject: "entityCrud",
  deleteSecret: "entityCrud",
  countActiveGoalsForCompany: "entityCrud",
  // createHireRequest is a multi-module composite that lives on
  // AppDatabase itself (spans agents + approvalsMod). Do not rewrite.
  // rollbackConfigRevision is the same (spans documents + entityCrud).
  // documentsMod
  saveDocument: "documentsMod",
  listImportantDocsForReview: "documentsMod",
  listDocuments: "documentsMod",
  getDocumentForUpdate: "documentsMod",
  updateDocumentStatus: "documentsMod",
  deleteDocument: "documentsMod",
  createDocumentRevision: "documentsMod",
  getDocumentLatestRevisionId: "documentsMod",
  listDocumentRevisions: "documentsMod",
  createWorkProduct: "documentsMod",
  updateWorkProduct: "documentsMod",
  listWorkProductsForTask: "documentsMod",
  listWorkProductsForCompany: "documentsMod",
  findWorkProductByExternalId: "documentsMod",
  resolveWorkProductTarget: "documentsMod",
  deleteWorkProduct: "documentsMod",
  archiveWorkProductsByExternalPaths: "documentsMod",
  linkDocumentToTask: "documentsMod",
  unlinkDocumentFromTask: "documentsMod",
  listDocumentsForTask: "documentsMod",
  listConfigRevisions: "documentsMod",
  getConfigRevision: "documentsMod",
  rollbackConfigRevision: "documentsMod",
  recordConfigRevision: "documentsMod",
  // knowledgeMod
  saveMeeting: "knowledgeMod",
  deleteMeeting: "knowledgeMod",
  listMeetings: "knowledgeMod",
  getMeeting: "knowledgeMod",
  saveKnowledgeEntry: "knowledgeMod",
  deleteKnowledgeEntry: "knowledgeMod",
  listKnowledgeEntries: "knowledgeMod",
  saveSprint: "knowledgeMod",
  deleteSprint: "knowledgeMod",
  listSprints: "knowledgeMod",
  collectRunDeliverableSignals: "knowledgeMod",
  // automationMod
  saveAutomationRule: "automationMod",
  deleteAutomationRule: "automationMod",
  listAutomationRuleNames: "automationMod",
  toggleAutomationRule: "automationMod",
  recordAutomationExecution: "automationMod",
  getAutomationLog: "automationMod",
  listActiveAutomationRules: "automationMod",
  saveWorkflow: "automationMod",
  getWorkflowRecord: "automationMod",
  updateWorkflowExecution: "automationMod",
  deleteWorkflow: "automationMod",
  listTriggerableWorkflows: "automationMod",
  // wakeup
  enqueueWakeupRequest: "wakeup",
  promoteWakeupRequests: "wakeup",
  listWakeupRequests: "wakeup",
  getPreferredWakeTrigger: "wakeup",
  completePendingWakeupRequests: "wakeup",
  purgeExpiredWakeupRequests: "wakeup",
  // backupMod
  exportBackup: "backupMod",
  createAutomaticBackup: "backupMod",
  restoreFromBackup: "backupMod",
  // threads
  createThread: "threads",
  listThreads: "threads",
  getThread: "threads",
  addThreadEvent: "threads",
  listThreadEvents: "threads",
  setThreadWaitState: "threads",
  resolveThreadWaitState: "threads",
  listThreadWaitStates: "threads",
  hasUnresolvedWaitStateForAgent: "threads",
  addParticipant: "threads",
  listParticipants: "threads",
  removeParticipant: "threads",
  subscribe: "threads",
  unsubscribe: "threads",
  listSubscriptions: "threads",
  listSubscribedThreads: "threads",
  // settings
  getCurrentCompanyId: "settings",
  setCurrentCompany: "settings",
  hasCompany: "settings",
  belongsToCompany: "settings",
  updateSettings: "settings",
  getLogRetentionDays: "settings",
  purgeExpiredRunLogs: "settings",
  canOpenPath: "settings",
  getDisabledModels: "settings",
  setDisabledModels: "settings",
  hasModelPoolSettings: "settings",
  getLastBudgetResetMonth: "settings",
  setLastBudgetResetMonth: "settings",
  // snap
  listSnapshot: "snap",
  listRendererSnapshot: "snap",
  // company
  saveCompany: "company",
  deleteCompany: "company",
  getCompanyStatus: "company",
  getCompanyBasic: "company",
  getCompanyExecutionMode: "company",
  getCompanyApprovalSettings: "company",
  listActiveCompanyIds: "company",
  getCompanyMetrics: "company",
  getStandupReport: "company",
  getDashboardSnapshot: "company",
  // connectorsCrud
  saveConnector: "connectorsCrud",
  updateConnectorHealth: "connectorsCrud",
  getConnector: "connectorsCrud",
  findConnector: "connectorsCrud",
  // agents (note: getAgent/findAgent live on entityCrud)
  saveAgent: "agents",
  deleteAgent: "agents",
  getAgent: "entityCrud",
  findAgent: "entityCrud",
  setHeartbeat: "agents",
  markHeartbeatAt: "agents",
  resetMonthlyBudgets: "agents",
  listHeartbeatEligibleAgents: "agents",
  getChainOfCommand: "agents",
  getDirectReports: "agents",
  getCeoForCompany: "agents",
  listActiveAgentsForCompany: "agents",
  listAgentsForApi: "agents",
  listDirectReportsForStandup: "agents",
  listReportStatusesForStandup: "agents",
  listExistingAgentsForHireCheck: "agents",
  hasAgentAssignedTasks: "agents",
  updateAgentStatus: "agents",
  isAgentPendingApproval: "agents",
  findMentionedAgentIds: "agents",
  getIdleAgentsForDepartment: "agents",
  getManagerForAgent: "agents",
  getAgentPermissions: "agents",
  setAgentPermission: "agents",
  hasAgentPermission: "agents",
  getRuntimeState: "agents",
  setRuntimeState: "agents",
  getHeartbeatPolicy: "agents",
  setHeartbeatPolicy: "agents",
  countActiveRunsForAgent: "agents",
  listDepartmentAgentIds: "agents",
  listCompanyBroadcastAgentIds: "agents",
  listIncidentPingableAgentIds: "agents",
  findAgentName: "agents",
  listAgentNamesByIds: "agents",
  listActiveAgentIdsFromIds: "agents",
  // tasks (note: getTask lives on entityCrud)
  saveTask: "tasks",
  getTask: "entityCrud",
  deleteTask: "tasks",
  getSessionById: "tasks",
  incrementSessionUsage: "tasks",
  archiveSession: "tasks",
  createNewSession: "tasks",
  ensureAgentSession: "tasks",
  setAgentSessionId: "tasks",
  getRecentRunsForTask: "tasks",
  getRecentActivityForTask: "tasks",
  checkoutTask: "tasks",
  releaseTaskLock: "tasks",
  renewTaskLease: "tasks",
  listAgentTasks: "tasks",
  listTasksByStatuses: "tasks",
  listAssigneeTasksForStandup: "tasks",
  listTasksForAssignees: "tasks",
  listReviewTasksForManager: "tasks",
  countActiveTasksForCompany: "tasks",
  countAdvancingTasksForCompany: "tasks",
  listChildTasks: "tasks",
  advanceTaskStatus: "tasks",
  setTaskRequiresUserReview: "tasks",
  hasPendingDeliverableReviews: "tasks",
  hasAgentPendingDeliverableReview: "tasks",
  hasAgentTaskAwaitingReview: "tasks",
  autoAssignTask: "tasks",
  getTaskRetryCount: "tasks",
  incrementTaskRetryCount: "tasks",
  resetTaskRetryCount: "tasks",
  retryInterruptedTask: "tasks",
  dismissInterruptedTask: "tasks",
  markInterruptedTaskFailed: "tasks",
  setTaskType: "tasks",
  listProjectTaskAssigneeIds: "tasks",
  listReviewTasksForSweep: "tasks",
  getTaskType: "tasks",
  // runs
  getRun: "runs",
  getRunAuthState: "runs",
  createRun: "runs",
  appendRunLog: "runs",
  readRunLog: "runs",
  readRunLogChunk: "runs",
  markRunStatus: "runs",
  finishRun: "runs",
  recordCostEntry: "runs",
  hasActiveRun: "runs",
  listQueuedRuns: "runs",
  getInterruptedRunsForRecovery: "runs",
  appendRunEvent: "runs",
  listRunEvents: "runs",
  listRunEventsAfter: "runs",
  updateRunActor: "runs",
  // approvalsMod
  requestApproval: "approvalsMod",
  decideApproval: "approvalsMod",
  getApprovalRecord: "approvalsMod",
  findApprovalById: "approvalsMod",
  deleteApproval: "approvalsMod",
  getBlockingApproval: "approvalsMod",
  resubmitApproval: "approvalsMod",
  addApprovalComment: "approvalsMod",
  listApprovalComments: "approvalsMod",
  linkTaskToApproval: "approvalsMod",
  unlinkTaskFromApproval: "approvalsMod",
  listApprovalsForTask: "approvalsMod",
  listTasksForApproval: "approvalsMod",
  linkManyTasksToApproval: "approvalsMod",
  listAgentPendingApprovals: "approvalsMod",
  listAgentResolvedApprovals: "approvalsMod",
  listPendingHireApprovalPayloads: "approvalsMod",
  listApprovalsForApi: "approvalsMod",
  findPendingApprovalForTask: "approvalsMod",
  hasPendingReviewApprovalForAgent: "approvalsMod",
  listCompanyApprovalsByType: "approvalsMod",
  // workspacesMod
  saveWorkspace: "workspacesMod",
  getWorkspace: "workspacesMod",
  getProjectPrimaryWorkspace: "workspacesMod",
  listWorkspaceLocalPaths: "workspacesMod",
  deleteWorkspace: "workspacesMod",
  acquireWorkspaceLock: "workspacesMod",
  claimWorkspaceLock: "workspacesMod",
  releaseWorkspaceLock: "workspacesMod",
  releaseAllWorkspaceLocks: "workspacesMod",
  releaseStaleWorkspaceLocks: "workspacesMod",
  isWorkspaceLocked: "workspacesMod",
};

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const modulesArg = args.find((a) => a.startsWith("--modules="));
const methodsArg = args.find((a) => a.startsWith("--methods="));
const includedModules = modulesArg
  ? new Set(modulesArg.split("=")[1].split(","))
  : null;
const extraMethods = methodsArg
  ? new Set(methodsArg.split("=")[1].split(","))
  : new Set();

const targetMethods = Object.entries(METHOD_TO_MODULE)
  .filter(([name, mod]) => {
    if (!includedModules) return true;
    if (includedModules.has(mod)) return true;
    if (extraMethods.has(name)) return true;
    return false;
  })
  .map(([m]) => m);

if (targetMethods.length === 0) {
  console.error("No methods matched module filter.");
  process.exit(2);
}

// Collect files via git ls-files (fast, respects .gitignore)
const filesOut = execSync("git ls-files 'src/**/*.ts' 'src/**/*.tsx' 'tests/**/*.ts'", {
  cwd: REPO_ROOT,
  encoding: "utf8",
});
const files = filesOut
  .split("\n")
  .filter(Boolean)
  .filter((f) => !f.startsWith("src/main/database.ts"))
  .filter((f) => !f.startsWith("src/main/database-base.ts"))
  .filter((f) => !f.startsWith("src/main/database/"));

// Build one giant alternation regex, non-capturing, then use a back-reference
// group only for the method name so we can look up the module.
const methodAlt = targetMethods
  .sort((a, b) => b.length - a.length) // longest-first to avoid partial shadow
  .join("|");

// Match `<optional qualifier>db.<method>(`. The qualifier must end with
// a `.` so `adb.saveTask(` (same token) is not matched. Examples that
// DO match: `db.saveTask(`, `this.db.saveTask(`, `shared.db.saveTask(`,
// `ctx.db.saveTask(`. The pre-anchor `(^|[^\w.])` keeps us from
// splitting an identifier token containing `db` somewhere in the middle.
const pattern = new RegExp(
  `(^|[^\\w.])((?:[\\w$]+\\.)*)db\\.(${methodAlt})\\(`,
  "g",
);

let totalReplacements = 0;
let changedFiles = 0;
const perFile = {};

for (const relPath of files) {
  const abs = join(REPO_ROOT, relPath);
  const src = readFileSync(abs, "utf8");
  let count = 0;
  const out = src.replace(pattern, (match, pre, qualifier, method) => {
    const mod = METHOD_TO_MODULE[method];
    if (!mod) return match;
    count += 1;
    return `${pre}${qualifier}db.${mod}.${method}(`;
  });
  if (count > 0) {
    perFile[relPath] = count;
    totalReplacements += count;
    changedFiles += 1;
    if (!dryRun) writeFileSync(abs, out);
  }
}

const hdr = dryRun ? "DRY RUN" : "APPLIED";
console.log(`${hdr}: ${totalReplacements} rewrites across ${changedFiles} files`);
for (const [f, n] of Object.entries(perFile).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n}\t${f}`);
}
