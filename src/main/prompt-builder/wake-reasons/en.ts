export type WakeReason =
  | "timer"
  | "manual"
  | "assignment"
  | "goal_activated"
  | "approval_resolved"
  | "subtask_completed"
  | "comment"
  | "report_blocked"
  | "report_failed"
  | "message"
  | "peer_request";

export interface WakeReasonVars {
  companyId: string;
  agentId: string;
}

export interface WakeReasonEntry {
  title: string;
  steps: (v: WakeReasonVars) => string[];
}

export const WAKE_REASONS: Record<WakeReason, WakeReasonEntry> = {
  timer: {
    title: "Regular heartbeat check-in. This is your periodic wake.",
    steps: () => [
      "Call GET /api/agents/me/standup to get your full briefing",
      "Review all your assigned tasks and their statuses",
      "Take action on the most important item: reviews > unblocking > new work",
      "If nothing needs attention, post a brief status update on your current task",
    ],
  },
  manual: {
    title: "You were manually triggered by the human operator (Board).",
    steps: () => [
      "Check your assigned tasks for any new assignments or updated instructions",
      "Check your messages for any direct communications",
      "Execute any pending work with high priority — the Board is watching",
    ],
  },
  assignment: {
    title: "You have been assigned a new task.",
    steps: (v) => [
      `GET /api/companies/${v.companyId}/issues?assigneeAgentId=${v.agentId}&status=todo to find your new assignment`,
      "Review the task title, description, and any existing comments",
      "POST /api/issues/{issueId}/checkout to claim the task",
      "Begin working on it immediately according to your Operating Instructions",
    ],
  },
  goal_activated: {
    title: "A goal you own has been activated.",
    steps: (v) => [
      `GET /api/companies/${v.companyId}/goals to find the newly activated goal`,
      `Decompose the goal into projects (POST /api/companies/${v.companyId}/projects)`,
      "Break projects into actionable tasks and assign to your team",
      "Leave a planning comment on each task explaining the approach",
    ],
  },
  approval_resolved: {
    title: "An approval you requested has been decided.",
    steps: (v) => [
      `GET /api/companies/${v.companyId}/approvals?requestedByAgentId=${v.agentId} to check the result`,
      "If APPROVED: proceed with the action you were waiting on (hiring, credential access, etc.)",
      "If DENIED or REVISION_REQUESTED: read the feedback, adjust your approach, and resubmit if appropriate",
      "Update the related task with the outcome",
    ],
  },
  subtask_completed: {
    title: "A subtask you delegated has been completed or moved to review.",
    steps: () => [
      'Check tasks with status "in_review" from your reports',
      "Read ALL comments on the completed subtask (GET /api/issues/{issueId}/comments)",
      "Review the work quality against the acceptance criteria you set",
      'If acceptable: PATCH /api/issues/{issueId} with status "done" and an approving comment',
      'If changes needed: PATCH /api/issues/{issueId} with status "in_progress" and specific feedback',
      "Check if the parent task can now progress",
    ],
  },
  comment: {
    title: "A new comment has been posted on one of your tasks.",
    steps: () => [
      "Check your recent comments in the briefing above",
      "If someone asked you a question: respond via POST /api/issues/{issueId}/comments",
      "If your manager left feedback: address it and update the task",
      "If it's a status update from a collaborator: acknowledge and adjust your work if needed",
    ],
  },
  report_blocked: {
    title: "One of your reports is blocked and needs your help.",
    steps: (v) => [
      `GET /api/companies/${v.companyId}/issues?status=blocked to find blocked tasks under your reports`,
      "Read the blocker comments to understand what they need",
      `Take action to unblock them:
   - If they need credentials: create a secret_access approval via POST /api/companies/${v.companyId}/approvals
   - If they need cross-department help: send a message to the relevant department lead
   - If they need clarification: post a comment with clear direction`,
      'After unblocking, wake the agent: POST /api/agents/{agentId}/wake with reason "blocker resolved"',
    ],
  },
  report_failed: {
    title: "A run by one of your reports has failed.",
    steps: () => [
      "Check your reports' task statuses for failed or stalled items",
      "Investigate: read the task comments and any error information",
      `Decide on next steps:
   - If the task should be retried: set status back to "todo" with a comment explaining what to do differently
   - If the task should be reassigned: change the assigneeAgentId to another capable report
   - If the task is no longer needed: set status to "cancelled" with explanation`,
      "Wake the relevant agent to take action",
    ],
  },
  message: {
    title: "You received a direct message from another agent.",
    steps: (v) => [
      `GET /api/companies/${v.companyId}/messages?unreadOnly=true to read your new messages`,
      "Read each message and understand what is being asked",
      `Respond to each message using the exact sender and message IDs returned by the API:
   - For direct messages, POST /api/companies/${v.companyId}/messages with channel="direct", toAgentId set to the original message's fromAgentId, and parentMessageId set to that message's id
   - If the sender is Board, the toAgentId is "__board__"`,
      `Mark messages as read: POST /api/companies/${v.companyId}/messages/{messageId}/read`,
      "If the message requires you to take action on a task, do so",
    ],
  },
  peer_request: {
    title: "A peer agent has requested your attention.",
    steps: (v) => [
      `Check your messages: GET /api/companies/${v.companyId}/messages?unreadOnly=true`,
      "Check for any new task assignments from outside your usual chain",
      "Read and respond to the peer's request using the sender's fromAgentId and message id from the API response",
      "If cross-department collaboration is needed, coordinate via messages and tasks",
    ],
  },
};

export function renderWakeReason(
  reason: string,
  vars: WakeReasonVars,
): string {
  const entry = WAKE_REASONS[reason as WakeReason];
  if (!entry) {
    return `Trigger: ${reason}\nAction required: Check your standup briefing and messages for context on why you were woken.`;
  }
  const steps = entry.steps(vars)
    .map((step, i) => `${i + 1}. ${step}`)
    .join("\n");
  return `${entry.title}\nAction required:\n${steps}`;
}
