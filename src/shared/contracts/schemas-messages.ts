import { z } from "zod";
import { MESSAGE_CHANNELS, optionalId } from "./helpers";

export const agentMessageInputSchema = z.object({
  companyId: z.string().uuid(),
  fromAgentId: z.union([z.string().uuid(), z.literal("__board__")]),
  toAgentId: z.preprocess(
    (v) => (v === "" ? null : v),
    z.union([z.string().uuid(), z.literal("__board__")]).nullable().optional(),
  ),
  channel: MESSAGE_CHANNELS.default("direct"),
  channelTargetId: z.string().nullable().optional(),
  subject: z.preprocess((v) => (v === "" ? "(no subject)" : v), z.string().min(1).max(200)),
  body: z.string().min(1).max(8000),
  priority: z.enum(["urgent", "normal", "low"]).default("normal"),
  parentMessageId: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable().optional()),
  attachmentsJson: z.string().default("[]"),
  threadId: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable().optional()),
  waitStateId: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable().optional()),
}).superRefine((value, ctx) => {
  if (value.channel === "direct" && !value.toAgentId) {
    ctx.addIssue({
      path: ["toAgentId"],
      code: z.ZodIssueCode.custom,
      message: "Direct messages require toAgentId.",
    });
  }

  if ((value.channel === "department" || value.channel === "project") && !value.channelTargetId) {
    ctx.addIssue({
      path: ["channelTargetId"],
      code: z.ZodIssueCode.custom,
      message: `${value.channel} messages require channelTargetId.`,
    });
  }

  if (value.channel !== "direct" && value.toAgentId) {
    ctx.addIssue({
      path: ["toAgentId"],
      code: z.ZodIssueCode.custom,
      message: "Only direct messages may set toAgentId.",
    });
  }
});

export const messageQuerySchema = z.object({
  companyId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
  channel: MESSAGE_CHANNELS.optional(),
  channelTargetId: z.string().nullable().optional(),
  unreadOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).default(200),
});

export const searchMessagesSchema = z.object({
  companyId: z.string().uuid(),
  query: z.string().min(1).max(200),
  channel: MESSAGE_CHANNELS.optional(),
  channelTargetId: z.string().nullable().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const commentInputSchema = z.object({
  companyId: z.string().uuid(),
  taskId: z.string().uuid(),
  authorAgentId: optionalId,
  authorName: z.string().min(1).max(80),
  body: z.string().min(1).max(4000),
});

export const listCommentsSchema = z.object({
  companyId: z.string().uuid(),
  taskId: z.string().uuid(),
});

export const documentInputSchema = z.object({
  id: optionalId,
  companyId: z.string().uuid(),
  type: z.enum(["prd", "technical_spec", "design_doc", "test_plan", "post_mortem", "meeting_notes", "budget_proposal", "hiring_requisition", "performance_review_doc", "sop", "knowledge_article", "project_brief", "sprint_report", "incident_report", "onboarding_guide", "architecture_decision", "status_report", "contract", "proposal"]),
  title: z.string().min(2).max(200),
  content: z.string().default(""),
  authorAgentId: optionalId,
  reviewerAgentId: optionalId,
  projectId: optionalId,
  goalId: optionalId,
  parentDocId: optionalId,
  version: z.number().int().min(1).default(1),
  status: z.enum(["draft", "in_review", "approved", "archived", "superseded"]).default("draft"),
  tagsJson: z.string().default("[]"),
});

export const knowledgeEntryInputSchema = z.object({
  id: optionalId,
  companyId: z.string().uuid(),
  category: z.enum(["lesson_learned", "best_practice", "decision", "process", "technical", "business", "onboarding", "incident"]),
  topic: z.string().min(2).max(200),
  content: z.string().min(1),
  authorAgentId: optionalId,
  importance: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  tagsJson: z.string().default("[]"),
  referencedEntityType: z.enum([
    "agents",
    "goals",
    "projects",
    "tasks",
    "approvals",
    "runs",
    "secrets",
    "meetings",
    "documents",
    "knowledge_base",
    "sprints",
    "automation_rules",
    "workflow_pipelines",
  ]).nullable().optional(),
  referencedEntityId: z.string().nullable().optional(),
});

export const meetingInputSchema = z.object({
  id: optionalId,
  companyId: z.string().uuid(),
  type: z.enum(["standup", "sprint_planning", "sprint_review", "retrospective", "one_on_one", "all_hands", "department_sync", "incident_review", "hiring_committee", "budget_review", "design_review", "architecture_review"]),
  title: z.string().min(2).max(160),
  organizerAgentId: optionalId,
  participantAgentIds: z.string().default("[]"),
  scheduledAt: z.string(),
  durationMinutes: z.number().int().min(5).max(480).default(30),
  agendaJson: z.string().default("[]"),
  notesJson: z.string().default("[]"),
  decisionsJson: z.string().default("[]"),
  actionItemsJson: z.string().default("[]"),
  status: z.enum(["scheduled", "in_progress", "completed", "cancelled"]).default("scheduled"),
});

export const markMessageReadSchema = z.object({
  messageId: z.string().uuid(),
  companyId: z.string().uuid(),
  readerAgentId: optionalId,
});
