import type { AgentRecord, AgentMessageRecord, ApprovalRecord, DocumentRecord, KnowledgeEntryRecord, MeetingRecord, TaskRecord } from "@shared/types";
import { inferTaskType } from "../connector-matching";
import { resolveAttachmentContent } from "./attachment-resolver";

interface TaskSectionCtx {
  task: TaskRecord;
  agent: { id: string; companyId: string; department: string | null | undefined };
  projects: Array<{ id: string; name: string }>;
  goals: Array<{ id: string; title: string }>;
}

export function buildTaskSection(ctx: TaskSectionCtx): string {
  const { task, agent, projects, goals } = ctx;
  const lines: string[] = [];

  lines.push(`# Current Task
- ID: ${task.id}
- Title: ${task.title}
- Description: ${task.description || "No description"}
- Status: ${task.status}
- Priority: ${task.priority}
${task.projectId ? `- Project: ${projects.find((p) => p.id === task.projectId)?.name ?? task.projectId}` : ""}
${task.goalId ? `- Goal: ${goals.find((g) => g.id === task.goalId)?.title ?? task.goalId}` : ""}
`);

  const taskType = task.taskType ?? inferTaskType(agent.department);

  if (taskType === "research") {
    lines.push(`# Deliverable Requirements (Research Task)
This is a research task. You MUST produce a tangible deliverable before marking it complete:

**Required:** Create at least ONE of:
1. A knowledge entry via POST /api/companies/${agent.companyId}/knowledge with your findings
2. A document via POST /api/companies/${agent.companyId}/documents with a structured report
3. A detailed comment on the task via PATCH /api/issues/${task.id} with body containing your analysis (minimum 100 words)

Do NOT mark the task as done or in_review without producing one of these artifacts.
Your manager will reject the task if no deliverable is found.
`);
  } else if (taskType === "content") {
    lines.push(`# Deliverable Requirements (Content Task)
This is a content creation task. You MUST produce a tangible deliverable before marking it complete:

**Required:** Create at least ONE of:
1. A document via POST /api/companies/${agent.companyId}/documents with the content draft
2. A social media draft via the social media queue
3. A detailed comment on the task via PATCH /api/issues/${task.id} with the content (minimum 100 words)

Do NOT mark the task as done or in_review without producing one of these artifacts.
Your manager will reject the task if no deliverable is found.
`);
  }

  return lines.join("\n");
}

interface ReviewSectionCtx {
  tasksAwaitingReview: TaskRecord[];
  allAgents: AgentRecord[];
  recentComments: Array<{ taskId: string; taskTitle: string; authorName: string; body: string; createdAt: string }>;
}

export function buildReviewSection(ctx: ReviewSectionCtx): string | null {
  if (ctx.tasksAwaitingReview.length === 0) return null;

  const reviewDetails = ctx.tasksAwaitingReview.map((t) => {
    const assigneeName = ctx.allAgents.find((a) => a.id === t.assigneeAgentId)?.name ?? "Unknown";
    const desc = t.description ? `\n  Description: ${t.description.slice(0, 300)}${t.description.length > 300 ? "..." : ""}` : "";
    const taskComments = ctx.recentComments
      .filter((c) => c.taskId === t.id)
      .slice(-3)
      .map((c) => `    - ${c.authorName}: "${c.body.slice(0, 150)}${c.body.length > 150 ? "..." : ""}"`)
      .join("\n");
    const commentSection = taskComments ? `\n  Recent comments:\n${taskComments}` : "\n  No comments yet.";
    return `- [${t.id}] ${t.title} (by ${assigneeName}, priority: ${t.priority})${desc}${commentSection}`;
  }).join("\n\n");

  return `# Tasks Awaiting Your Review (${ctx.tasksAwaitingReview.length} pending)

${reviewDetails}

REVIEW WORKFLOW — This is your HIGHEST PRIORITY after resolving blockers:
1. For EACH task above, first read ALL comments: GET /api/issues/{issueId}/comments
2. Evaluate whether the work meets the task description and acceptance criteria
3. To APPROVE: PATCH /api/issues/{issueId} with {"status": "done", "comment": "Approved. <your feedback>"}
4. To REQUEST CHANGES: PATCH /api/issues/{issueId} with {"status": "in_progress", "comment": "Changes needed: <specific feedback>"}
5. Do NOT ignore review requests — your team is blocked until you respond
`;
}

interface MessagesSectionCtx {
  recentMessages: AgentMessageRecord[];
  allAgents: AgentRecord[];
  companyDocuments?: DocumentRecord[];
}

export function buildMessagesSection(ctx: MessagesSectionCtx): string | null {
  if (ctx.recentMessages.length === 0) return null;

  const agentMap = new Map(ctx.allAgents.map((a) => [a.id, a.name]));
  const msgLines = ctx.recentMessages.slice(0, 15).map((m) => {
    const from = m.fromAgentId === "__board__" ? "Board (__board__)" : (agentMap.get(m.fromAgentId) ?? m.fromAgentId);
    const channelLabel = m.channel === "direct"
      ? `DM with ${m.fromAgentId === "__board__" ? "Board (__board__)" : from}`
      : `#${m.channel}${m.channelTargetId ? `-${m.channelTargetId}` : ""}`;
    const isUnread = !m.readAt;
    let attachmentNote = "";
    let attachmentContent = "";
    if (m.attachmentsJson && m.attachmentsJson !== "[]") {
      try {
        const atts = JSON.parse(m.attachmentsJson) as Array<{ title?: string }>;
        if (Array.isArray(atts) && atts.length > 0) {
          attachmentNote = ` [Attached: ${atts.map((a) => a.title ?? "document").join(", ")}]`;
        }
      } catch { /* malformed attachment JSON */ }
      if (ctx.companyDocuments && ctx.companyDocuments.length > 0) {
        attachmentContent = resolveAttachmentContent(m.attachmentsJson, ctx.companyDocuments, 4000);
      }
    }
    const responseHint = m.channel === "direct"
      ? ` Reply with channel=direct, toAgentId="${m.fromAgentId}", parentMessageId="${m.id}".`
      : ` Reply in channel "${m.channel}"${m.channelTargetId ? ` with channelTargetId="${m.channelTargetId}"` : ""}, parentMessageId="${m.id}".`
    const line = `- ${isUnread ? "[UNREAD] " : ""}[ID:${m.id}] [${channelLabel}] ${from}: "${m.subject}" — ${m.body.slice(0, 120)}${m.body.length > 120 ? "..." : ""}${attachmentNote}${responseHint}`;
    return attachmentContent ? `${line}\n${attachmentContent}` : line;
  });
  const unreadCount = ctx.recentMessages.filter((m) => !m.readAt).length;

  return `# Your Messages${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}
${msgLines.join("\n")}
${unreadCount > 0 ? "\n**ACTION REQUIRED**: Read and respond to unread messages before starting new work. Mark messages as read after processing: POST /api/companies/{companyId}/messages/{messageId}/read" : ""}
`;
}

interface MeetingsSectionCtx {
  upcomingMeetings: MeetingRecord[];
  allAgents: AgentRecord[];
}

export function buildMeetingsSection(ctx: MeetingsSectionCtx): string | null {
  if (ctx.upcomingMeetings.length === 0) return null;

  const meetingLines = ctx.upcomingMeetings.slice(0, 5).map((m) => {
    const organizer = m.organizerAgentId ? (ctx.allAgents.find(a => a.id === m.organizerAgentId)?.name ?? "Unknown") : "TBD";
    let participants: string[];
    try { participants = JSON.parse(m.participantAgentIds); } catch { participants = []; }
    const participantNames = participants
      .map(id => ctx.allAgents.find(a => a.id === id)?.name ?? id)
      .join(", ");
    return `- [${m.type}] ${m.title} — Organizer: ${organizer}, Participants: ${participantNames || "TBD"}, At: ${m.scheduledAt}, Duration: ${m.durationMinutes}min, Status: ${m.status}`;
  });

  return `# Upcoming Meetings
${meetingLines.join("\n")}

If you organized a meeting, prepare the agenda. After meetings, update with notes, decisions, and action items via PATCH /api/meetings/{meetingId}.
`;
}

export function buildKnowledgeSection(entries: KnowledgeEntryRecord[]): string | null {
  if (entries.length === 0) return null;

  const knowledgeLines = entries.slice(0, 20).map((k) => {
    const contentLimit = 600;
    const truncated = k.content.length > contentLimit
      ? k.content.slice(0, contentLimit) + "..."
      : k.content;
    return `- [${k.category}/${k.importance}] ${k.topic}: ${truncated}`;
  });

  return `# Relevant Knowledge Base
${knowledgeLines.join("\n")}

Use this knowledge to inform your decisions. Add new lessons via POST /api/companies/{companyId}/knowledge.
`;
}

interface DocumentsSectionCtx {
  recentDocuments: DocumentRecord[];
  allAgents: AgentRecord[];
}

export function buildDocumentsSection(ctx: DocumentsSectionCtx): string | null {
  if (ctx.recentDocuments.length === 0) return null;

  const docLines = ctx.recentDocuments.slice(0, 5).map((d) => {
    const author = d.authorAgentId ? (ctx.allAgents.find(a => a.id === d.authorAgentId)?.name ?? "Unknown") : "System";
    const header = `- [${d.type}] ${d.title} — by ${author}, status: ${d.status}, updated: ${d.updatedAt}`;
    if (d.content && d.content.length > 0) {
      const contentLimit = 2000;
      const excerpt = d.content.length > contentLimit
        ? d.content.slice(0, contentLimit) + "..."
        : d.content;
      return `${header}\n  Content:\n  ${excerpt.split("\n").join("\n  ")}`;
    }
    return header;
  });

  return `# Recent Documents
${docLines.join("\n\n")}

Reference these documents when relevant to your current work. Create new documents for important work artifacts.
`;
}

export function buildPendingApprovalsSection(approvals: ApprovalRecord[]): string | null {
  if (approvals.length === 0) return null;

  return `# Pending Approvals
${approvals.map((a) => `- [${a.id}] ${a.type}: ${a.payloadSummary} (status: ${a.state})`).join("\n")}
`;
}
