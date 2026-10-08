export interface CreateDocumentInput {
  orgId: string;
  title: string;
  docType: string;
  content: string;
  authorAgentId: string | null;
  reviewerAgentId: string | null;
  projectId: string | null;
  goalId: string | null;
  taskId: string | null;
}

export interface UpdateDocumentInput {
  orgId: string;
  documentId: string;
  title: string;
  content: string;
  status: string;
  /** Why it changed; kept with the new version. */
  reason: string;
  changedByType: "employee" | "agent";
  changedById: string;
}

export interface DeleteDocumentInput {
  orgId: string;
  documentId: string;
  deletedByEmployeeId: string;
}

export type KnowledgeScopeType = "organization" | "project" | "goal" | "task" | "agent";

export interface CreateKnowledgeEntryInput {
  orgId: string;
  topic: string;
  category: string;
  content: string;
  importance: string;
  sourceType: string;
  sourceId: string | null;
  scopeType: KnowledgeScopeType;
  /** Required unless the scope is organization. */
  scopeId: string | null;
  /** UTC ISO time the entry stops applying, or null. */
  validUntil: string | null;
  /** An older entry this one replaces. */
  supersedesId: string | null;
}

export interface UpdateKnowledgeEntryInput {
  orgId: string;
  entryId: string;
  topic: string;
  category: string;
  content: string;
  importance: string;
  /** Why it changed; kept in the revision history. */
  reason: string;
  changedByType: "employee" | "agent";
  changedById: string;
}

export interface DocumentVersionRecord {
  version: number;
  title: string;
  content: string;
  status: string;
  changedByType: string;
  changedById: string | null;
  reason: string;
  createdAt: string;
}

export interface KnowledgeRevisionRecord {
  revision: number;
  topic: string;
  category: string;
  content: string;
  importance: string;
  changedByType: string;
  changedById: string | null;
  reason: string;
  createdAt: string;
}

export interface ListDocumentVersionsInput {
  orgId: string;
  documentId: string;
}

export interface ListKnowledgeRevisionsInput {
  orgId: string;
  entryId: string;
}

export interface ResumeGoalInput {
  orgId: string;
  goalId: string;
}

export interface DeleteKnowledgeEntryInput {
  orgId: string;
  entryId: string;
  deletedByEmployeeId: string;
}

export interface CreateAutomationRuleInput {
  orgId: string;
  name: string;
  triggerEvent: string;
  conditions: Record<string, unknown>;
  actionType: string;
  actionConfig: Record<string, unknown>;
  priority: number;
  enabled: boolean;
}

export interface UpdateAutomationRuleInput {
  orgId: string;
  ruleId: string;
  name: string;
  triggerEvent: string;
  conditions: Record<string, unknown>;
  actionType: string;
  actionConfig: Record<string, unknown>;
  priority: number;
  enabled: boolean;
}

export interface DeleteAutomationRuleInput {
  orgId: string;
  ruleId: string;
}

export interface CreateMeetingInput {
  orgId: string;
  title: string;
  meetingType: string;
  scheduledAt: string | null;
  durationMinutes: number;
  agenda: string;
}

export interface DeleteMeetingInput {
  orgId: string;
  meetingId: string;
}

export interface CreateSprintInput {
  orgId: string;
  name: string;
  goal: string;
  startDate: string;
  endDate: string;
}

export interface DeleteSprintInput {
  orgId: string;
  sprintId: string;
}
