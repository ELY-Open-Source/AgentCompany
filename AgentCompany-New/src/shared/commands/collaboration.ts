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
}

export interface DeleteDocumentInput {
  orgId: string;
  documentId: string;
}

export interface CreateKnowledgeEntryInput {
  orgId: string;
  topic: string;
  category: string;
  content: string;
  importance: string;
  sourceType: string;
  sourceId: string | null;
}

export interface DeleteKnowledgeEntryInput {
  orgId: string;
  entryId: string;
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
