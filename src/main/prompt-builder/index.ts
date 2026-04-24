import type { AgentRecord, ApprovalRecord, DocumentRecord, ExecutionMode, GoalRecord, KnowledgeEntryRecord, MeetingRecord, ProjectRecord, SprintRecord, TaskRecord } from "@shared/types";
import type { AppLocale } from "@shared/locale";
import type { ProjectedSkill } from "../skill-types";
import { buildSystemPrompt, buildVolatilePromptTail } from "./system-prompt";
import { renderWakeReason } from "./wake-reasons";
import { getSystemMessages } from "./messages";

export { buildStableSystemPrompt, buildSystemPrompt, buildVolatilePromptTail } from "./system-prompt";

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
  upcomingMeetings?: MeetingRecord[];
  relevantKnowledge?: KnowledgeEntryRecord[];
  activeSprint?: SprintRecord | null;
  recentDocuments?: DocumentRecord[];
  allConnectors?: Array<{ id: string; label: string; status: string; enabledModels?: string[] }>;
  /** D-07: Handoff markdown from a rotated session, injected as context for the agent */
  sessionHandoff?: string | null;
  /** Skills visible to this agent via pi's progressive-disclosure model. */
  skills?: ProjectedSkill[];
  /** All company documents for attachment content resolution in messages */
  companyDocuments?: DocumentRecord[];
  /** Company-wide skill catalog for capability-aware delegation. */
  companySkillCatalog?: Array<{ name: string; slug: string; description: string | null }>;
  /** Company workspaces visible to the current run. */
  companyWorkspaces?: Array<{ name: string; localPath: string }>;
  /**
   * Pending-skip context from the heartbeat scheduler. Present only
   * when the scheduler most recently refused to dispatch this agent
   * (e.g. worker not ready, cooldown). Surfacing it into the system
   * prompt is the reader half of the scheduler-side write — without
   * it, a multi-day skip streak would be invisible to the agent even
   * though `runtime_state_json.heartbeatSkip` tracks it precisely.
   */
  heartbeatSkip?: {
    reason: string;
    streak: number;
    since: string;
    lastTickAt: string;
  } | null;
}

export function buildTaskPrompt(ctx: PromptContext): string {
  const m = getSystemMessages();
  const systemPrompt = buildSystemPrompt(ctx);
  const parts: string[] = [systemPrompt];

  // Volatile per-turn context lives AFTER the cacheable system prefix so the
  // Anthropic prompt cache hits across heartbeats. Putting the wall-clock
  // time inside the system prompt would invalidate the cache on every call.
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const timeStr = now.toISOString().split("T")[1]?.slice(0, 5) ?? "00:00";
  const dayOfWeek = m.dayNames[now.getUTCDay()] ?? "";
  parts.push(`\n${m.currentDateSection(dayOfWeek, dateStr, timeStr)}`);

  if (ctx.wakeReason) {
    const explanation = renderWakeReason(ctx.wakeReason, {
      companyId: ctx.agent.companyId,
      agentId: ctx.agent.id,
    });
    parts.push(`\n${m.wakeReasonHeading}\n${explanation}\n`);
  }

  if (ctx.heartbeatSkip) {
    parts.push(`\n${m.heartbeatSkipSection(ctx.heartbeatSkip)}`);
  }

  parts.push(`\n${m.timeAwarenessSection}`);

  // Taskless runs used to emit a "respond with a brief status summary"
  // nudge here. That text fought the wake-reason block above and caused
  // communication wakes to degrade into self-narration. The wake-reason
  // section already tells the agent what to do; the initial user turn
  // (assembled at dispatch) supplies the concrete action cue — no fallback
  // text is needed for the system prompt anymore.
  if (ctx.task) {
    parts.push(m.immediateTaskSection(ctx.task.title, ctx.task.description, ctx.task.priority));
  }

  const volatileContextTail = buildVolatilePromptTail(ctx);
  if (volatileContextTail) {
    parts.push(`\n${volatileContextTail}`);
  }

  return parts.join("");
}
