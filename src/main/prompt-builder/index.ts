import type { AgentRecord, AgentMessageRecord, ApprovalRecord, DocumentRecord, ExecutionMode, GoalRecord, KnowledgeEntryRecord, MeetingRecord, ProjectRecord, SprintRecord, TaskRecord } from "@shared/types";
import type { AppLocale } from "@shared/locale";
import { buildSystemPrompt } from "./system-prompt";
import { renderWakeReason } from "./wake-reasons";
import { getSystemMessages } from "./messages";

export interface PromptContext {
  agent: AgentRecord;
  apiUrl: string;
  apiKey: string;
  runId: string;
  task: TaskRecord | null;
  companyName: string;
  locale?: AppLocale;
  /** Company execution mode: ai_ceo (fully autonomous) or ai_cofounder (human-reviewed) */
  executionMode?: ExecutionMode;
  goals: GoalRecord[];
  projects: ProjectRecord[];
  directReports: AgentRecord[];
  chainOfCommand: AgentRecord[];
  assignedTasks: TaskRecord[];
  allAgents: AgentRecord[];
  pendingApprovals: ApprovalRecord[];
  tasksAwaitingReview: TaskRecord[];
  wakeReason: string | null;
  allTasks: TaskRecord[];
  recentComments: Array<{ taskId: string; taskTitle: string; authorName: string; body: string; createdAt: string }>;
  companyDescription: string;
  socialAccounts: Array<{ id: string; platform: string; accountName: string; status: string; requireApproval: boolean }>;
  recentMessages?: AgentMessageRecord[];
  upcomingMeetings?: MeetingRecord[];
  relevantKnowledge?: KnowledgeEntryRecord[];
  activeSprint?: SprintRecord | null;
  recentDocuments?: DocumentRecord[];
  allConnectors?: Array<{ id: string; label: string; status: string; enabledModels?: string[] }>;
  /** D-07: Handoff markdown from a rotated session, injected as context for the agent */
  sessionHandoff?: string | null;
  /** Names of skills injected into this agent's runtime environment */
  skillNames?: string[];
  /** Full skill entries with semantic metadata for capability manifest */
  skillEntries?: Array<{ name: string; whenToUse: string; allowedTools: string[]; effort: string; contextMode: string }>;
  /** All company documents for attachment content resolution in messages */
  companyDocuments?: DocumentRecord[];
  /** Company-wide skill catalog for capability-aware delegation. */
  companySkillCatalog?: Array<{ name: string; slug: string; description: string | null }>;
  /** Company workspaces visible to the current run. */
  companyWorkspaces?: Array<{ name: string; localPath: string }>;
}

export function buildTaskPrompt(ctx: PromptContext): string {
  const m = getSystemMessages(ctx.locale);
  const systemPrompt = buildSystemPrompt(ctx);
  const parts: string[] = [systemPrompt];

  if (ctx.wakeReason) {
    const explanation = renderWakeReason(ctx.wakeReason, {
      companyId: ctx.agent.companyId,
      agentId: ctx.agent.id,
    }, ctx.locale);
    parts.push(`\n${m.wakeReasonHeading}\n${explanation}\n`);
  }

  parts.push(`\n${m.timeAwarenessSection}`);

  if (ctx.task) {
    parts.push(m.immediateTaskSection(ctx.task.title, ctx.task.description, ctx.task.priority));
  } else {
    parts.push(m.heartbeatFallbackSection);
  }

  return parts.join("");
}
