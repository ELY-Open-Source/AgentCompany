import type { AgentRecord, AgentMessageRecord, ApprovalRecord, DocumentRecord, ExecutionMode, GoalRecord, KnowledgeEntryRecord, MeetingRecord, ProjectRecord, SprintRecord, TaskRecord } from "@shared/types";
import type { AppLocale } from "@shared/locale";
import { buildSystemPrompt } from "./system-prompt";

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
  const systemPrompt = buildSystemPrompt(ctx);
  const parts: string[] = [systemPrompt];

  if (ctx.wakeReason) {
    const reasonMap: Record<string, string> = {
      timer: `Regular heartbeat check-in. This is your periodic wake.
Action required:
1. Call GET /api/agents/me/standup to get your full briefing
2. Review all your assigned tasks and their statuses
3. Take action on the most important item: reviews > unblocking > new work
4. If nothing needs attention, post a brief status update on your current task`,

      manual: `You were manually triggered by the human operator (Board).
Action required:
1. Check your assigned tasks for any new assignments or updated instructions
2. Check your messages for any direct communications
3. Execute any pending work with high priority — the Board is watching`,

      assignment: `You have been assigned a new task.
Action required:
1. GET /api/companies/${ctx.agent.companyId}/issues?assigneeAgentId=${ctx.agent.id}&status=todo to find your new assignment
2. Review the task title, description, and any existing comments
3. POST /api/issues/{issueId}/checkout to claim the task
4. Begin working on it immediately according to your Operating Instructions`,

      goal_activated: `A goal you own has been activated.
Action required:
1. GET /api/companies/${ctx.agent.companyId}/goals to find the newly activated goal
2. Decompose the goal into projects (POST /api/companies/${ctx.agent.companyId}/projects)
3. Break projects into actionable tasks and assign to your team
4. Leave a planning comment on each task explaining the approach`,

      approval_resolved: `An approval you requested has been decided.
Action required:
1. GET /api/companies/${ctx.agent.companyId}/approvals?requestedByAgentId=${ctx.agent.id} to check the result
2. If APPROVED: proceed with the action you were waiting on (hiring, credential access, etc.)
3. If DENIED or REVISION_REQUESTED: read the feedback, adjust your approach, and resubmit if appropriate
4. Update the related task with the outcome`,

      subtask_completed: `A subtask you delegated has been completed or moved to review.
Action required:
1. Check tasks with status "in_review" from your reports
2. Read ALL comments on the completed subtask (GET /api/issues/{issueId}/comments)
3. Review the work quality against the acceptance criteria you set
4. If acceptable: PATCH /api/issues/{issueId} with status "done" and an approving comment
5. If changes needed: PATCH /api/issues/{issueId} with status "in_progress" and specific feedback
6. Check if the parent task can now progress`,

      comment: `A new comment has been posted on one of your tasks.
Action required:
1. Check your recent comments in the briefing above
2. If someone asked you a question: respond via POST /api/issues/{issueId}/comments
3. If your manager left feedback: address it and update the task
4. If it's a status update from a collaborator: acknowledge and adjust your work if needed`,

      report_blocked: `One of your reports is blocked and needs your help.
Action required:
1. GET /api/companies/${ctx.agent.companyId}/issues?status=blocked to find blocked tasks under your reports
2. Read the blocker comments to understand what they need
3. Take action to unblock them:
   - If they need credentials: create a secret_access approval via POST /api/companies/${ctx.agent.companyId}/approvals
   - If they need cross-department help: send a message to the relevant department lead
   - If they need clarification: post a comment with clear direction
4. After unblocking, wake the agent: POST /api/agents/{agentId}/wake with reason "blocker resolved"`,

      report_failed: `A run by one of your reports has failed.
Action required:
1. Check your reports' task statuses for failed or stalled items
2. Investigate: read the task comments and any error information
3. Decide on next steps:
   - If the task should be retried: set status back to "todo" with a comment explaining what to do differently
   - If the task should be reassigned: change the assigneeAgentId to another capable report
   - If the task is no longer needed: set status to "cancelled" with explanation
4. Wake the relevant agent to take action`,

      message: `You received a direct message from another agent.
Action required:
1. GET /api/companies/${ctx.agent.companyId}/messages?unreadOnly=true to read your new messages
2. Read each message and understand what is being asked
3. Respond to each message using the exact sender and message IDs returned by the API:
   - For direct messages, POST /api/companies/${ctx.agent.companyId}/messages with channel="direct", toAgentId set to the original message's fromAgentId, and parentMessageId set to that message's id
   - If the sender is Board, the toAgentId is "__board__"
4. Mark messages as read: POST /api/companies/${ctx.agent.companyId}/messages/{messageId}/read
5. If the message requires you to take action on a task, do so`,

      peer_request: `A peer agent has requested your attention.
Action required:
1. Check your messages: GET /api/companies/${ctx.agent.companyId}/messages?unreadOnly=true
2. Check for any new task assignments from outside your usual chain
3. Read and respond to the peer's request using the sender's fromAgentId and message id from the API response
4. If cross-department collaboration is needed, coordinate via messages and tasks`,
    };
    const explanation = reasonMap[ctx.wakeReason] ?? `Trigger: ${ctx.wakeReason}\nAction required: Check your standup briefing and messages for context on why you were woken.`;
    parts.push(`\n# Wake Reason\n${explanation}\n`);
  }

  parts.push(`\n# Time Awareness
Consider what phase of operations the company is in and prioritize accordingly:
- Early in a sprint cycle → planning, task breakdown, delegation
- Mid-sprint → execution, unblocking, progress updates
- Late sprint → reviews, quality checks, retrospective preparation
- End of month → status reports, budget reviews, performance check-ins
- End of quarter → strategy reviews, goal setting, performance evaluations
`);

  if (ctx.task) {
    parts.push(`\n---\n\nYour immediate task:\n\nTitle: ${ctx.task.title}\nDescription: ${ctx.task.description || "No additional description."}\nPriority: ${ctx.task.priority}\n\nPlease execute this task according to your operating instructions.`);
  } else {
    parts.push(`\n---\n\nYou have been woken for a heartbeat check. Review your assigned tasks and active goals, then take appropriate action. If there's nothing to do, respond with a brief status summary.`);
  }

  return parts.join("");
}
