import { z } from "zod";
import type * as C from "../../../shared/commands";

const id = z.string();
const nullableId = z.string().nullable();
const actor = z.enum(["employee", "agent"]);
const sender = z.enum(["employee", "agent", "board", "system"]);

export const collaborationContracts = {
  createDocument: z.strictObject({
    orgId: id, title: z.string(), docType: z.string(), content: z.string(), authorAgentId: nullableId, reviewerAgentId: nullableId,
    projectId: nullableId, goalId: nullableId, taskId: nullableId,
  }) satisfies z.ZodType<C.CreateDocumentInput>,
  updateDocument: z.strictObject({
    orgId: id, documentId: id, title: z.string(), content: z.string(), status: z.string(), reason: z.string(), changedByType: actor, changedById: id,
  }) satisfies z.ZodType<C.UpdateDocumentInput>,
  deleteDocument: z.strictObject({ orgId: id, documentId: id, deletedByEmployeeId: id }) satisfies z.ZodType<C.DeleteDocumentInput>,
  listDocumentVersions: z.strictObject({ orgId: id, documentId: id }) satisfies z.ZodType<C.ListDocumentVersionsInput>,
  createKnowledgeEntry: z.strictObject({
    orgId: id, topic: z.string(), category: z.string(), content: z.string(), importance: z.string(), sourceType: z.string(), sourceId: nullableId,
    scopeType: z.enum(["organization", "project", "goal", "task", "agent"]), scopeId: nullableId, validUntil: z.string().nullable(), supersedesId: nullableId,
  }) satisfies z.ZodType<C.CreateKnowledgeEntryInput>,
  updateKnowledgeEntry: z.strictObject({
    orgId: id, entryId: id, topic: z.string(), category: z.string(), content: z.string(), importance: z.string(), reason: z.string(),
    changedByType: actor, changedById: id,
  }) satisfies z.ZodType<C.UpdateKnowledgeEntryInput>,
  deleteKnowledgeEntry: z.strictObject({ orgId: id, entryId: id, deletedByEmployeeId: id }) satisfies z.ZodType<C.DeleteKnowledgeEntryInput>,
  listKnowledgeRevisions: z.strictObject({ orgId: id, entryId: id }) satisfies z.ZodType<C.ListKnowledgeRevisionsInput>,
  createMeeting: z.strictObject({
    orgId: id, title: z.string(), meetingType: z.string(), scheduledAt: z.string().nullable(), durationMinutes: z.number(), agenda: z.string(),
  }) satisfies z.ZodType<C.CreateMeetingInput>,
  deleteMeeting: z.strictObject({ orgId: id, meetingId: id }) satisfies z.ZodType<C.DeleteMeetingInput>,
  createSprint: z.strictObject({ orgId: id, name: z.string(), goal: z.string(), startDate: z.string(), endDate: z.string() }) satisfies z.ZodType<C.CreateSprintInput>,
  deleteSprint: z.strictObject({ orgId: id, sprintId: id }) satisfies z.ZodType<C.DeleteSprintInput>,
  createChatSpace: z.strictObject({
    orgId: id, spaceType: z.enum(["company", "division", "department", "project", "pod", "ad_hoc", "direct"]), name: z.string(), topic: z.string(),
    visibility: z.enum(["workspace", "restricted"]), retentionPolicy: z.enum(["standard_365d", "restricted_365d"]).optional(),
    memberEmployeeIds: z.array(id).optional(), memberAgentIds: z.array(id).optional(),
  }) satisfies z.ZodType<C.CreateChatSpaceInput>,
  sendMessage: z.strictObject({
    orgId: id, spaceId: id, threadId: nullableId, senderType: sender, senderId: nullableId, bodyMd: z.string(), attachmentFileIds: z.array(id).optional(),
  }) satisfies z.ZodType<C.SendMessageInput>,
  editMessage: z.strictObject({ orgId: id, messageId: id, actorType: sender, actorId: nullableId, bodyMd: z.string() }) satisfies z.ZodType<C.EditMessageInput>,
  deleteMessage: z.strictObject({ orgId: id, messageId: id, actorType: sender, actorId: nullableId }) satisfies z.ZodType<C.DeleteMessageInput>,
  markChatSpaceRead: z.strictObject({ orgId: id, employeeId: id, spaceId: id, upToMessageId: id }) satisfies z.ZodType<C.MarkChatSpaceReadInput>,
};
