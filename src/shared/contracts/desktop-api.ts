import { z } from "zod";
import type {
  AgentMessageRecord,
  AgentMetrics,
  AgentRecord,
  ApprovalRecord,
  BrowserActionRecord,
  BudgetIncidentRecord,
  BudgetPolicyRecord,
  BudgetStatusSummary,
  CommentRecord,
  CompanyMetrics,
  ConversationEventRecord,
  ConversationParticipantRecord,
  ConversationThreadRecord,
  DesktopEvent,
  InboxItem,
  OnboardingBootstrapResult,
  ProfileSnapshot,
  RunLogChunk,
  RunRecord,
  SkillImportResult,
  SkillRecord,
  SkillUpdateStatus,
  StandupReport,
  TaskRecord,
  ThreadSubscriptionRecord,
  ThreadWaitStateRecord,
} from "../types";
import type { SidebarBadges } from "./schemas-misc";
import type { WakeupRequestRecord } from "./schemas-misc";
import {
  agentInputSchema,
  heartbeatSettingsSchema,
  hireRequestSchema,
  triggerHeartbeatSchema,
} from "./schemas-agents";
import {
  approvalDecisionSchema,
  approvalInputSchema,
} from "./schemas-approvals";
import {
  browserActionQuerySchema,
  cancelBrowserActionSchema,
  cancelRunSchema,
  openTerminalCommandSchema,
  runLogChunkSchema,
  runLogSchema,
  runWorkflowSchema,
  startRunSchema,
  triggerBrowserLoginSchema,
  workflowInputSchema,
} from "./schemas-execution";
import {
  commentInputSchema,
  documentInputSchema,
  knowledgeEntryInputSchema,
  listCommentsSchema,
  markMessageReadSchema,
  meetingInputSchema,
  messageQuerySchema,
  searchMessagesSchema,
  agentMessageInputSchema,
} from "./schemas-messages";
import {
  automationRuleInputSchema,
  budgetPolicyInputSchema,
  createThreadSchema,
  addThreadEventSchema,
  deleteBudgetPolicySchema,
  deleteEntitySchema,
  entityGetterSchema,
  listBudgetIncidentsSchema,
  listThreadEventsSchema,
  listThreadsSchema,
  listThreadWaitStatesSchema,
  metricsQuerySchema,
  resolveThreadWaitStateSchema,
  resolveBudgetIncidentSchema,
  setThreadWaitStateSchema,
  threadGetterSchema,
  toggleAutomationRuleSchema,
  wakeupQuerySchema,
  listParticipantsSchema,
  addParticipantSchema,
  removeParticipantSchema,
  subscribeThreadSchema,
  unsubscribeThreadSchema,
  listSubscriptionsSchema,
  listSubscribedThreadsSchema,
} from "./schemas-misc";
import {
  autoAssignSchema,
  goalInputSchema,
  projectInputSchema,
  sprintInputSchema,
  taskInputSchema,
} from "./schemas-tasks";
import {
  bootstrapOnboardingSchema,
  companyInputSchema,
  connectorDisabledModelsSchema,
  connectorInputSchema,
  secretInputSchema,
  settingsSchema,
  socialAccountInputSchema,
  workspaceInputSchema,
} from "./schemas-company";

export type DesktopResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export interface SaveTaskResult {
  id: string;
  capabilityWarning?: string;
}

export interface ConfigRevisionSummary {
  id: string;
  agentId: string;
  revisionNumber: number;
  changedKeys: string[];
  source: string;
  rolledBackFromRevisionId: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdAt: string;
}

export interface ConfigRevisionDetail extends ConfigRevisionSummary {
  configBefore: Record<string, unknown>;
  configAfter: Record<string, unknown>;
}

export interface RunEventRecord {
  id: number;
  runId: string;
  agentId: string;
  seq: number;
  eventType: string;
  stream: string | null;
  level: string | null;
  message: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface HeartbeatPolicy {
  enabled: boolean;
  intervalSec: number;
  cooldownSec: number;
  maxConcurrentRuns: number;
  wakeOnDemand: boolean;
}

export type DesktopApi = {
  loadSnapshot: () => Promise<DesktopResult<ProfileSnapshot>>;
  pickDirectory: () => Promise<DesktopResult<string | null>>;
  openPath: (targetPath: string) => Promise<DesktopResult<boolean>>;
  saveCompany: (input: z.infer<typeof companyInputSchema>) => Promise<DesktopResult<string>>;
  setCurrentCompany: (companyId: string) => Promise<DesktopResult<boolean>>;
  saveConnector: (input: z.infer<typeof connectorInputSchema>) => Promise<DesktopResult<boolean>>;
  testConnector: (id: z.infer<typeof connectorInputSchema.shape.id>) => Promise<DesktopResult<boolean>>;
  saveWorkspace: (input: z.infer<typeof workspaceInputSchema>) => Promise<DesktopResult<string>>;
  saveAgent: (input: z.infer<typeof agentInputSchema>) => Promise<DesktopResult<string>>;
  requestHire: (input: z.infer<typeof hireRequestSchema>) => Promise<DesktopResult<{ agentId: string; approvalId: string; autoApproved: boolean }>>;
  saveGoal: (input: z.infer<typeof goalInputSchema>) => Promise<DesktopResult<string>>;
  saveProject: (input: z.infer<typeof projectInputSchema>) => Promise<DesktopResult<string>>;
  saveTask: (input: z.infer<typeof taskInputSchema>) => Promise<DesktopResult<SaveTaskResult>>;
  requestApproval: (input: z.infer<typeof approvalInputSchema>) => Promise<DesktopResult<string>>;
  decideApproval: (input: z.infer<typeof approvalDecisionSchema>) => Promise<DesktopResult<boolean>>;
  saveSecret: (input: z.infer<typeof secretInputSchema>) => Promise<DesktopResult<string>>;
  startTaskRun: (input: z.infer<typeof startRunSchema>) => Promise<DesktopResult<string>>;
  cancelRun: (input: z.infer<typeof cancelRunSchema>) => Promise<DesktopResult<boolean>>;
  getRunLog: (input: z.infer<typeof runLogSchema>) => Promise<DesktopResult<string>>;
  getRunLogChunk: (input: z.infer<typeof runLogChunkSchema>) => Promise<DesktopResult<RunLogChunk>>;
  backupProfile: () => Promise<DesktopResult<string | null>>;
  restoreProfile: () => Promise<DesktopResult<boolean>>;
  updateSettings: (input: z.infer<typeof settingsSchema>) => Promise<DesktopResult<boolean>>;
  checkForUpdates: () => Promise<DesktopResult<boolean>>;
  deleteCompany: (companyId: string) => Promise<DesktopResult<boolean>>;
  deleteAgent: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  deleteTask: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  deleteGoal: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  deleteProject: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  deleteWorkspace: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  deleteApproval: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  deleteSecret: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  getSidebarBadges: (companyId: string) => Promise<DesktopResult<SidebarBadges>>;
  listConnectorModels: (connectorId: string) => Promise<DesktopResult<Array<{ id: string; label: string }>>>;
  getConnectorDisabledModels: (connectorId: string) => Promise<DesktopResult<Array<{ id: string; label: string }>>>;
  setConnectorDisabledModels: (input: z.infer<typeof connectorDisabledModelsSchema>) => Promise<DesktopResult<boolean>>;
  openConnectorAuthTerminal: (connectorId: z.infer<typeof connectorInputSchema.shape.id>) => Promise<DesktopResult<boolean>>;
  addComment: (input: z.infer<typeof commentInputSchema>) => Promise<DesktopResult<string>>;
  listComments: (input: z.infer<typeof listCommentsSchema>) => Promise<DesktopResult<CommentRecord[]>>;
  setHeartbeat: (input: z.infer<typeof heartbeatSettingsSchema>) => Promise<DesktopResult<boolean>>;
  triggerHeartbeat: (input: z.infer<typeof triggerHeartbeatSchema>) => Promise<DesktopResult<string>>;
  getApiPort: () => Promise<DesktopResult<number>>;
  getInbox: (companyId: string) => Promise<DesktopResult<InboxItem[]>>;
  getCompanyMetrics: (input: z.infer<typeof metricsQuerySchema>) => Promise<DesktopResult<CompanyMetrics>>;
  getAgentMetrics: (input: z.infer<typeof metricsQuerySchema>) => Promise<DesktopResult<AgentMetrics>>;
  getStandupReport: (companyId: string) => Promise<DesktopResult<StandupReport>>;
  bootstrapOnboarding: (input: z.infer<typeof bootstrapOnboardingSchema>) => Promise<DesktopResult<OnboardingBootstrapResult>>;
  checkNodeInstalled: () => Promise<DesktopResult<{ installed: boolean; version: string | null }>>;
  openTerminalCommand: (input: z.infer<typeof openTerminalCommandSchema>) => Promise<DesktopResult<boolean>>;
  saveSocialAccount: (input: z.infer<typeof socialAccountInputSchema>) => Promise<DesktopResult<string>>;
  deleteSocialAccount: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  listBrowserActions: (input: z.infer<typeof browserActionQuerySchema>) => Promise<DesktopResult<BrowserActionRecord[]>>;
  cancelBrowserAction: (input: z.infer<typeof cancelBrowserActionSchema>) => Promise<DesktopResult<boolean>>;
  triggerBrowserLogin: (input: z.infer<typeof triggerBrowserLoginSchema>) => Promise<DesktopResult<boolean>>;
  saveMeeting: (input: z.infer<typeof meetingInputSchema>) => Promise<DesktopResult<string>>;
  deleteMeeting: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  saveDocument: (input: z.infer<typeof documentInputSchema>) => Promise<DesktopResult<string>>;
  deleteDocument: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  saveKnowledgeEntry: (input: z.infer<typeof knowledgeEntryInputSchema>) => Promise<DesktopResult<string>>;
  deleteKnowledgeEntry: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  saveSprint: (input: z.infer<typeof sprintInputSchema>) => Promise<DesktopResult<string>>;
  deleteSprint: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  saveAutomationRule: (input: z.infer<typeof automationRuleInputSchema>) => Promise<DesktopResult<string>>;
  deleteAutomationRule: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  toggleAutomationRule: (input: z.infer<typeof toggleAutomationRuleSchema>) => Promise<DesktopResult<boolean>>;
  getAutomationLog: (companyId: string) => Promise<DesktopResult<Array<{ ruleId: string; ruleName: string; trigger: string; action: string; executedAt: string }>>>;
  sendAgentMessage: (input: z.infer<typeof agentMessageInputSchema>) => Promise<DesktopResult<import("@shared/types").SendMessageResult>>;
  listAgentMessages: (input: z.infer<typeof messageQuerySchema>) => Promise<DesktopResult<AgentMessageRecord[]>>;
  markMessageRead: (input: z.infer<typeof markMessageReadSchema>) => Promise<DesktopResult<boolean>>;
  saveWorkflow: (input: z.infer<typeof workflowInputSchema>) => Promise<DesktopResult<string>>;
  deleteWorkflow: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  runWorkflow: (input: z.infer<typeof runWorkflowSchema>) => Promise<DesktopResult<boolean>>;
  autoAssignTask: (input: z.infer<typeof autoAssignSchema>) => Promise<DesktopResult<string>>;
  searchMessages: (input: z.infer<typeof searchMessagesSchema>) => Promise<DesktopResult<AgentMessageRecord[]>>;
  importSkill: (companyId: string, source: string) => Promise<DesktopResult<SkillImportResult[]>>;
  listSkills: (companyId: string) => Promise<DesktopResult<SkillRecord[]>>;
  getSkillDetail: (companyId: string, skillId: string) => Promise<DesktopResult<SkillRecord>>;
  deleteSkill: (companyId: string, skillId: string) => Promise<DesktopResult<void>>;
  assignSkillToAgent: (companyId: string, agentId: string, skillId: string) => Promise<DesktopResult<void>>;
  removeSkillFromAgent: (companyId: string, agentId: string, skillId: string) => Promise<DesktopResult<void>>;
  checkSkillUpdate: (companyId: string, skillId: string) => Promise<DesktopResult<SkillUpdateStatus>>;
  listSkillAgents: (companyId: string, skillId: string) => Promise<DesktopResult<string[]>>;
  listAgentSkills: (companyId: string, agentId: string) => Promise<DesktopResult<string[]>>;
  listWakeupRequests: (input: z.infer<typeof wakeupQuerySchema>) => Promise<DesktopResult<WakeupRequestRecord[]>>;
  saveBudgetPolicy: (input: z.infer<typeof budgetPolicyInputSchema>) => Promise<DesktopResult<string>>;
  deleteBudgetPolicy: (input: z.infer<typeof deleteBudgetPolicySchema>) => Promise<DesktopResult<boolean>>;
  listBudgetPolicies: (companyId: string) => Promise<DesktopResult<BudgetPolicyRecord[]>>;
  listBudgetIncidents: (input: z.infer<typeof listBudgetIncidentsSchema>) => Promise<DesktopResult<BudgetIncidentRecord[]>>;
  resolveBudgetIncident: (input: z.infer<typeof resolveBudgetIncidentSchema>) => Promise<DesktopResult<boolean>>;
  getBudgetStatus: (companyId: string) => Promise<DesktopResult<BudgetStatusSummary>>;
  recoveryRetry: (taskId: string, agentId: string, companyId: string) => Promise<DesktopResult<null>>;
  recoveryDismiss: (taskId: string) => Promise<DesktopResult<null>>;
  recoveryFail: (taskId: string) => Promise<DesktopResult<null>>;
  getTask: (input: z.infer<typeof entityGetterSchema>) => Promise<DesktopResult<TaskRecord>>;
  getAgent: (input: z.infer<typeof entityGetterSchema>) => Promise<DesktopResult<AgentRecord>>;
  getRun: (input: z.infer<typeof entityGetterSchema>) => Promise<DesktopResult<RunRecord>>;
  getApproval: (input: z.infer<typeof entityGetterSchema>) => Promise<DesktopResult<ApprovalRecord>>;
  listConfigRevisions: (companyId: string, agentId: string) => Promise<DesktopResult<ConfigRevisionSummary[]>>;
  getConfigRevision: (companyId: string, revisionId: string) => Promise<DesktopResult<ConfigRevisionDetail>>;
  rollbackConfigRevision: (companyId: string, agentId: string, revisionId: string) => Promise<DesktopResult<{ revisionId: string }>>;
  listRunEvents: (companyId: string, runId: string, opts?: { offset?: number; limit?: number }) => Promise<DesktopResult<RunEventRecord[]>>;
  getAgentPermissions: (agentId: string) => Promise<DesktopResult<Record<string, boolean>>>;
  setAgentPermission: (companyId: string, agentId: string, permissionKey: string, enabled: boolean) => Promise<DesktopResult<boolean>>;
  getHeartbeatPolicy: (agentId: string, companyId: string) => Promise<DesktopResult<HeartbeatPolicy>>;
  setHeartbeatPolicy: (companyId: string, agentId: string, policy: Record<string, unknown>) => Promise<DesktopResult<boolean>>;
  getRuntimeState: (agentId: string, companyId: string) => Promise<DesktopResult<Record<string, unknown>>>;
  setRuntimeState: (companyId: string, agentId: string, state: Record<string, unknown>) => Promise<DesktopResult<boolean>>;
  // Thread runtime
  createThread: (input: z.infer<typeof createThreadSchema>) => Promise<DesktopResult<ConversationThreadRecord>>;
  listThreads: (input: z.infer<typeof listThreadsSchema>) => Promise<DesktopResult<ConversationThreadRecord[]>>;
  getThread: (input: z.infer<typeof threadGetterSchema>) => Promise<DesktopResult<ConversationThreadRecord>>;
  addThreadEvent: (input: z.infer<typeof addThreadEventSchema>) => Promise<DesktopResult<ConversationEventRecord>>;
  listThreadEvents: (input: z.infer<typeof listThreadEventsSchema>) => Promise<DesktopResult<ConversationEventRecord[]>>;
  setThreadWaitState: (input: z.infer<typeof setThreadWaitStateSchema>) => Promise<DesktopResult<ThreadWaitStateRecord>>;
  resolveThreadWaitState: (input: z.infer<typeof resolveThreadWaitStateSchema>) => Promise<DesktopResult<boolean>>;
  listThreadWaitStates: (input: z.infer<typeof listThreadWaitStatesSchema>) => Promise<DesktopResult<ThreadWaitStateRecord[]>>;
  listParticipants: (input: z.infer<typeof listParticipantsSchema>) => Promise<DesktopResult<ConversationParticipantRecord[]>>;
  addParticipant: (input: z.infer<typeof addParticipantSchema>) => Promise<DesktopResult<ConversationParticipantRecord>>;
  removeParticipant: (input: z.infer<typeof removeParticipantSchema>) => Promise<DesktopResult<boolean>>;
  subscribeThread: (input: z.infer<typeof subscribeThreadSchema>) => Promise<DesktopResult<ThreadSubscriptionRecord>>;
  unsubscribeThread: (input: z.infer<typeof unsubscribeThreadSchema>) => Promise<DesktopResult<boolean>>;
  listSubscriptions: (input: z.infer<typeof listSubscriptionsSchema>) => Promise<DesktopResult<ThreadSubscriptionRecord[]>>;
  listSubscribedThreads: (input: z.infer<typeof listSubscribedThreadsSchema>) => Promise<DesktopResult<ConversationThreadRecord[]>>;
  subscribe: (callback: (event: DesktopEvent) => void) => () => void;
  platform: "win32" | "darwin" | "linux";
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;
};
