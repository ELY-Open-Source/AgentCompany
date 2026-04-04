import type { AgentStatus, RunStatus, InboxItemType } from "./enums";
import type {
  SocialPlatform,
  SocialAccountStatus,
  BrowserActionType,
  BrowserActionStatus,
  MeetingType,
  MeetingStatus,
  DocumentType,
  DocumentStatus,
  KnowledgeCategory,
  SprintStatus,
  AutomationTrigger,
  AutomationAction,
  AutomationStatus,
  MessageChannel,
  MessagePriority,
  WorkflowStatus,
  WorkProductType,
  WorkProductStatus,
  WorkProductReviewState,
  ThreadType,
  ThreadActorType,
  ThreadEventType,
  ThreadParticipantRole,
  ThreadWaitingFor,
  ThreadNotifyOn,
  DepartmentId,
} from "./enums";

export interface SocialAccountRecord {
  id: string;
  companyId: string;
  platform: SocialPlatform;
  accountName: string;
  displayName: string;
  profileUrl: string;
  credentialSecretId: string | null;
  status: SocialAccountStatus;
  requireApproval: boolean;
  metadataJson: string;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BrowserActionRecord {
  id: string;
  companyId: string;
  socialAccountId: string;
  agentId: string;
  taskId: string | null;
  actionType: BrowserActionType;
  payloadJson: string;
  status: BrowserActionStatus;
  resultSummary: string;
  screenshotPath: string | null;
  approvalId: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingRecord {
  id: string;
  companyId: string;
  type: MeetingType;
  title: string;
  organizerAgentId: string | null;
  participantAgentIds: string; // JSON array of agent IDs
  scheduledAt: string;
  durationMinutes: number;
  agendaJson: string;
  notesJson: string;
  decisionsJson: string;
  actionItemsJson: string;
  status: MeetingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentRecord {
  id: string;
  companyId: string;
  type: DocumentType;
  title: string;
  content: string;
  authorAgentId: string | null;
  reviewerAgentId: string | null;
  projectId: string | null;
  goalId: string | null;
  parentDocId: string | null;
  version: number;
  status: DocumentStatus;
  tagsJson: string;
  latestRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentRevisionRecord {
  id: string;
  companyId: string;
  documentId: string;
  revisionNumber: number;
  body: string;
  changeSummary: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdAt: string;
}

export interface ApprovalCommentRecord {
  id: string;
  companyId: string;
  approvalId: string;
  authorAgentId: string | null;
  authorUserId: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkProductRecord {
  id: string;
  companyId: string;
  projectId: string | null;
  taskId: string;
  type: WorkProductType;
  provider: string;
  externalId: string | null;
  title: string;
  url: string | null;
  status: WorkProductStatus;
  reviewState: WorkProductReviewState;
  isPrimary: boolean;
  summary: string | null;
  metadataJson: string | null;
  createdByRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDocumentLink {
  id: string;
  companyId: string;
  taskId: string;
  documentId: string;
  key: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeEntryRecord {
  id: string;
  companyId: string;
  category: KnowledgeCategory;
  topic: string;
  content: string;
  authorAgentId: string | null;
  importance: "critical" | "high" | "medium" | "low";
  tagsJson: string;
  referencedEntityType:
    | "agents"
    | "goals"
    | "projects"
    | "tasks"
    | "approvals"
    | "runs"
    | "secrets"
    | "meetings"
    | "documents"
    | "knowledge_base"
    | "sprints"
    | "automation_rules"
    | "workflow_pipelines"
    | null;
  referencedEntityId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SprintRecord {
  id: string;
  companyId: string;
  name: string;
  goal: string;
  startDate: string;
  endDate: string;
  status: SprintStatus;
  retrospectiveNotes: string;
  velocityPoints: number;
  completedPoints: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRuleRecord {
  id: string;
  companyId: string;
  name: string;
  description: string;
  trigger: AutomationTrigger;
  conditionsJson: string;
  action: AutomationAction;
  actionConfigJson: string;
  sourceDepartment: DepartmentId | null;
  targetDepartment: DepartmentId | null;
  priority: number;
  status: AutomationStatus;
  executionCount: number;
  lastExecutedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMessageRecord {
  id: string;
  companyId: string;
  fromAgentId: string;
  toAgentId: string | null;
  senderKind: "agent" | "human" | "system";
  channel: MessageChannel;
  channelTargetId: string | null;
  subject: string;
  body: string;
  priority: MessagePriority;
  readAt: string | null;
  parentMessageId: string | null;
  attachmentsJson: string;
  createdAt: string;
}

export interface WorkflowPipelineRecord {
  id: string;
  companyId: string;
  name: string;
  description: string;
  stepsJson: string;
  triggerType: AutomationTrigger;
  triggerConfigJson: string;
  status: WorkflowStatus;
  currentStepIndex: number;
  runCount: number;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStep {
  id: string;
  name: string;
  action: AutomationAction;
  configJson: string;
  assigneeDepartment: DepartmentId | null;
  assigneeAgentId: string | null;
  requiresApproval: boolean;
  timeoutSec: number;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
}

export interface ConversationThreadRecord {
  id: string;
  companyId: string;
  title: string;
  type: ThreadType;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationEventRecord {
  id: string;
  threadId: string;
  actorId: string;
  actorType: ThreadActorType;
  eventType: ThreadEventType;
  body: string;
  metadataJson: string;
  createdAt: string;
}

export interface ConversationParticipantRecord {
  threadId: string;
  participantId: string;
  participantType: ThreadActorType;
  role: ThreadParticipantRole;
  joinedAt: string;
}

export interface ThreadSubscriptionRecord {
  threadId: string;
  subscriberId: string;
  subscriberType: ThreadActorType;
  notifyOn: ThreadNotifyOn;
  subscribedAt: string;
}

export interface ThreadWaitStateRecord {
  id: string;
  threadId: string;
  companyId: string;
  waitingFor: ThreadWaitingFor;
  relatedApprovalId: string | null;
  reason: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface InboxItem {
  id: string;
  type: InboxItemType;
  title: string;
  subtitle: string;
  severity: "critical" | "high" | "medium" | "low";
  entityType: string;
  entityId: string;
  agentId: string | null;
  agentName: string | null;
  createdAt: string;
}

export interface AgentMetrics {
  agentId: string;
  agentName: string;
  tasksCompleted: number;
  tasksAssigned: number;
  tasksFailed: number;
  successRate: number;
  avgRunDurationSec: number;
  totalCostUsd: number;
  runsTotal: number;
  runsSucceeded: number;
  runsFailed: number;
  reviewCycles: number;
  lastActiveAt: string | null;
}

export interface CompanyMetrics {
  totalAgents: number;
  activeAgents: number;
  totalTasks: number;
  completedTasks: number;
  blockedTasks: number;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  overallSuccessRate: number;
  totalCostUsd: number;
  avgCostPerTask: number;
  throughputTasksPerDay: number;
  agentMetrics: AgentMetrics[];
}

export interface OnboardingBootstrapResult {
  companyId: string;
  companyName: string;
  workspaceId: string | null;
  leadAgentId: string | null;
  projectId: string | null;
  taskId: string | null;
  runId: string | null;
}

export interface StandupReport {
  companyId: string;
  generatedAt: string;
  summary: string;
  agentReports: Array<{
    agentId: string;
    agentName: string;
    role: string;
    status: AgentStatus;
    tasksInProgress: number;
    tasksCompleted24h: number;
    tasksBlocked: number;
    lastRunStatus: RunStatus | null;
    lastRunAt: string | null;
    costLast24h: number;
    highlights: string[];
  }>;
  companyHighlights: string[];
  blockers: string[];
  pendingApprovals: number;
  budgetUtilization: number;
}
