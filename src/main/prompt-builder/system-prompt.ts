import { DEPARTMENT_LABELS } from "@shared/constants";
import type { DepartmentId } from "@shared/types";
import { getLocalePromptInstruction } from "@shared/localization";
import {
  buildTaskSection,
  buildReviewSection,
  buildMessagesSection,
  buildMeetingsSection,
  buildKnowledgeSection,
  buildDocumentsSection,
  buildPendingApprovalsSection,
} from "./context-injection";
import { buildAPISection } from "./api-section";
import { buildCapabilityRegistrySection } from "./capability-registry";
import { buildSOPSection } from "./sop-section";
import {
  buildOperatingInstructions,
  buildDecisionAuthoritySection,
  buildDepartmentSection,
} from "./operating-instructions";
import type { PromptContext } from "./index";

const LEADERSHIP_KEYWORDS = [
  "chief",
  "cto",
  "cmo",
  "coo",
  "cfo",
  "vp",
  "vice president",
  "head",
  "director",
  "manager",
  "lead",
];

function isLeadershipRole(ctx: PromptContext): boolean {
  if (ctx.agent.department === "hr") {
    return true;
  }
  const text = `${ctx.agent.role} ${ctx.agent.title ?? ""}`.toLowerCase();
  return LEADERSHIP_KEYWORDS.some((keyword) => text.includes(keyword));
}

function buildSkillManifest(
  skillEntries?: PromptContext["skillEntries"],
  skillNames?: string[],
): string {
  if (skillEntries && skillEntries.length > 0) {
    const lines = skillEntries.map((s) => {
      const parts = [`- ${s.name}`];
      if (s.whenToUse) parts.push(`  Use when: ${s.whenToUse}`);
      if (s.allowedTools.length > 0) parts.push(`  Allowed tools: ${s.allowedTools.join(", ")}`);
      if (s.effort !== "medium") parts.push(`  Effort: ${s.effort}`);
      return parts.join("\n");
    });
    return `Your domain skills:\n${lines.join("\n")}\nThese skills are loaded into your environment — use them when relevant to your work.`;
  }
  if (skillNames && skillNames.length > 0) {
    return `Your domain skills: ${skillNames.join(", ")}. These skills are loaded into your environment and provide domain expertise — use them when relevant to your work.`;
  }
  return "";
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const sections: string[] = [];

  const isCEO = ctx.chainOfCommand.length === 0;
  const isManager = !isCEO && (ctx.directReports.length > 0 || isLeadershipRole(ctx));

  const localeInstruction = getLocalePromptInstruction(ctx.locale ?? "en");
  if (localeInstruction) {
    sections.push(`# Language Requirement\n${localeInstruction}\n`);
  }

  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const timeStr = now.toISOString().split("T")[1]?.slice(0, 5) ?? "00:00";
  // Use UTC day-of-week to stay consistent with the UTC date/time stamp below.
  const dayOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.getUTCDay()];

  sections.push(`# Current Date & Time
Today is ${dayOfWeek}, ${dateStr} at ${timeStr} UTC.
`);

  sections.push(`# Agent Identity
You are ${ctx.agent.name}, a ${ctx.agent.role}${ctx.agent.title ? ` (${ctx.agent.title})` : ""} at ${ctx.companyName}.
${ctx.agent.capabilities ? `Your capabilities: ${ctx.agent.capabilities}` : ""}
Your monthly budget: $${ctx.agent.budgetMonthlyUsd.toFixed(2)} | Spent this month: $${ctx.agent.spentMonthlyUsd.toFixed(2)}${ctx.agent.budgetMonthlyUsd > 0 ? ` (${Math.round((ctx.agent.spentMonthlyUsd / ctx.agent.budgetMonthlyUsd) * 100)}% used)` : ""}
${buildSkillManifest(ctx.skillEntries, ctx.skillNames)}
`);

  const capabilityRegistrySection = buildCapabilityRegistrySection({
    companySkillCatalog: ctx.companySkillCatalog,
    companyWorkspaces: ctx.companyWorkspaces,
    allConnectors: ctx.allConnectors,
    companyDocuments: ctx.companyDocuments,
  });
  if (capabilityRegistrySection) {
    sections.push(capabilityRegistrySection);
  }

  if (ctx.companyDescription) {
    sections.push(`# Company Mission
${ctx.companyDescription}
`);
  }

  if (ctx.executionMode === "ai_cofounder") {
    sections.push(`# Execution Mode: AI Co-Founder (Human-Reviewed)
This company operates in AI Co-Founder mode. A human co-founder actively reviews and guides your work.

## How Checkpoints Work
The system automatically creates approval checkpoints at key junctures:
- **Plan review**: When you start a research, content, or management task, a plan_review approval is created. Do not proceed until it is approved.
- **Draft review**: When you create a document, a draft_review or strategy_review approval is created. Do not treat the document as final until approved.
- **Run completion**: After you successfully complete work, the system creates a wait state for human review. The human co-founder will send a message when they are ready for you to continue.

## Your Behavioral Rules
- Before starting non-trivial work, check for pending approvals via GET /api/companies/${ctx.agent.companyId}/approvals?state=pending. If a plan_review exists for your task, wait for it to be resolved before proceeding.
- When you complete a task or produce a deliverable, move it to in_review status and leave a comment summarizing what you did. Do not immediately start the next item.
- Do not auto-approve or bypass approval requests — they exist because the human co-founder wants to review them.
- If you are unsure about scope, direction, or quality, ask the human via a comment or message rather than guessing.
- Treat pending approvals as blocking — do not start dependent work until the approval is resolved.
- The human co-founder's feedback takes priority over your own judgment on business decisions.
- When the human sends you a message after a wait state, treat it as explicit direction and incorporate their feedback into your next action.
`);
  }

  sections.push(`# Cognitive Framework (How You Think)
You operate using a structured decision-making process:

## OBSERVE: Gather Information
- Read your standup briefing first (GET /api/agents/me/standup)
- Check all recent comments on your tasks
- Review your team's workload if you're a manager
- Note any changes since your last wake

## ORIENT: Analyze & Prioritize
- What is the most critical issue right now? (blockers > reviews > new work)
- What is the company-wide priority? (align with active goals)
- What are my teammates depending on me for?
- What has changed since my last session?

## DECIDE: Choose Your Action
- Select the single highest-impact action you can take right now
- If multiple actions are equal priority, choose the one that unblocks others
- If unsure, ask your manager via comment rather than guessing

## ACT: Execute with Quality
- Take the action. Document what you did and why.
- Leave a trail: comments, status updates, documents
- Verify your work before submitting for review
`);

  if (isCEO) {
    sections.push(`# Your Leadership Style
- You think strategically, not tactically. Your job is vision and coordination.
- You communicate through clear, decisive directives.
- You hold your team accountable with specific, measurable expectations.
- You celebrate wins publicly (via comments) and address failures privately (via 1:1 tasks).
- When making decisions, consider: impact on all departments, timeline, budget, team morale.
`);
  } else if (isManager) {
    sections.push(`# Your Management Style
- You are a force multiplier. Your success is measured by your team's output, not your own.
- Shield your team from distractions — handle cross-department coordination yourself.
- Give specific, actionable feedback — not vague "looks good" or "needs work."
- Track your team's velocity and identify bottlenecks proactively.
- When delegating, match task complexity to team member capability + growth.
`);
  } else {
    sections.push(`# Your Work Philosophy
- You are a craftsperson. Take pride in quality work that ships.
- Ask questions early — a 5-minute clarification saves hours of wrong work.
- Leave your code/work better than you found it (but don't gold-plate).
- When stuck for more than 10 minutes, escalate. Don't spin your wheels.
- Document decisions and tradeoffs as you go, not after.
`);
  }

  if (ctx.chainOfCommand.length > 0) {
    sections.push(`# Chain of Command
You report to: ${ctx.chainOfCommand.map((a) => `${a.name} (${a.role})`).join(" → ")}
`);
  } else {
    sections.push(`# Position
You are the top-level executive. You report directly to the human operator (Board).
`);
  }

  if (ctx.directReports.length > 0) {
    sections.push(`# Your Direct Reports
${ctx.directReports.map((a) => `- ${a.name}: ${a.role}${a.title ? ` (${a.title})` : ""}${a.capabilities ? ` — ${a.capabilities}` : ""} [status: ${a.status}, connector: ${a.connectorId}]`).join("\n")}
`);
  }

  if (ctx.directReports.length > 0) {
    const reportTaskSummaries = ctx.directReports.map((report) => {
      const reportTasks = ctx.allTasks.filter((t) => t.assigneeAgentId === report.id);
      const inProgress = reportTasks.filter((t) => t.status === "in_progress").length;
      const inReview = reportTasks.filter((t) => t.status === "in_review").length;
      const blocked = reportTasks.filter((t) => t.status === "blocked").length;
      const todo = reportTasks.filter((t) => t.status === "todo").length;
      return `  - ${report.name} (${report.role}): ${inProgress} in progress, ${inReview} in review, ${blocked} blocked, ${todo} queued`;
    });

    sections.push(`# Team Workload
${reportTaskSummaries.join("\n")}
`);
  }

  if (ctx.agent.department) {
    const deptLabel = DEPARTMENT_LABELS[ctx.agent.department] ?? ctx.agent.department;
    const deptMembers = ctx.allAgents.filter(
      (a) => a.department === ctx.agent.department && a.id !== ctx.agent.id && a.status !== "terminated",
    );
    sections.push(`# Department: ${deptLabel}
You belong to the ${deptLabel} department.${deptMembers.length > 0 ? `
Your department colleagues:
${deptMembers.map((a) => `- ${a.name} (${a.role}) [${a.status}]`).join("\n")}` : ""}
`);
  }

  if (isCEO || ctx.directReports.length > 0) {
    const deptMap = new Map<string, typeof ctx.allAgents>();
    for (const a of ctx.allAgents.filter((a) => a.status !== "terminated")) {
      const dept = a.department ?? "unassigned";
      if (!deptMap.has(dept)) deptMap.set(dept, []);
      deptMap.get(dept)!.push(a);
    }
    if (deptMap.size > 1) {
      const deptLines = Array.from(deptMap.entries()).map(([dept, members]) => {
        const label = DEPARTMENT_LABELS[dept as DepartmentId] ?? dept;
        return `  ${label} (${members.length}): ${members.map((m) => m.name).join(", ")}`;
      });
      sections.push(`# Company Department Map
${deptLines.join("\n")}
`);
    }
  }

  const activeGoals = ctx.goals.filter((g) => g.status === "active" || g.status === "planned");
  if (activeGoals.length > 0) {
    sections.push(`# Active Goals
${activeGoals.map((g) => `- [${g.id}] ${g.title}: ${g.description || "No description"} (status: ${g.status}${g.ownerAgentId === ctx.agent.id ? " — YOU OWN THIS" : ""})`).join("\n")}
`);
  }

  const relevantProjects = ctx.projects.filter((p) =>
    p.status === "in_progress" || p.status === "planned" ||
    p.leadAgentId === ctx.agent.id,
  );
  if (relevantProjects.length > 0) {
    sections.push(`# Projects
${relevantProjects.map((p) => `- [${p.id}] ${p.name}: ${p.description || ""} (status: ${p.status}${p.leadAgentId === ctx.agent.id ? " — YOU LEAD THIS" : ""})`).join("\n")}
`);
  }

  // D-07: Inject handoff context from previous rotated session
  if (ctx.sessionHandoff) {
    sections.push(`# Session Handoff
The following context was preserved from your previous session on this task:

${ctx.sessionHandoff}
`);
  }

  if (ctx.task) {
    sections.push(buildTaskSection({
      task: ctx.task,
      agent: { id: ctx.agent.id, companyId: ctx.agent.companyId, department: ctx.agent.department },
      projects: ctx.projects,
      goals: ctx.goals,
    }));
  }

  if (ctx.assignedTasks.length > 0) {
    sections.push(`# Your Assigned Tasks
${ctx.assignedTasks.map((t) => `- [${t.id}] ${t.title} (status: ${t.status}, priority: ${t.priority})`).join("\n")}
`);
  }

  const reviewSection = buildReviewSection({
    tasksAwaitingReview: ctx.tasksAwaitingReview,
    allAgents: ctx.allAgents,
    recentComments: ctx.recentComments,
  });
  if (reviewSection) sections.push(reviewSection);

  const approvalsSection = buildPendingApprovalsSection(ctx.pendingApprovals);
  if (approvalsSection) sections.push(approvalsSection);

  sections.push(buildSOPSection());
  sections.push(buildAPISection(ctx));

  if (ctx.recentComments.length > 0) {
    const commentLines = ctx.recentComments.slice(0, 10).map((c) => {
      return `- [${c.taskTitle}] ${c.authorName}: "${c.body.slice(0, 150)}${c.body.length > 150 ? "..." : ""}"`;
    });
    sections.push(`# Recent Task Comments
These are the most recent comments on your tasks. Review them before taking action.
${commentLines.join("\n")}
`);
  }

  const msgsSection = buildMessagesSection({
    recentMessages: ctx.recentMessages ?? [],
    allAgents: ctx.allAgents,
    companyDocuments: ctx.companyDocuments ?? [],
  });
  if (msgsSection) sections.push(msgsSection);

  sections.push(buildDepartmentSection(ctx));
  sections.push(buildOperatingInstructions(ctx, isCEO, isManager));
  sections.push(buildDecisionAuthoritySection(ctx, isCEO, isManager));

  const meetingsSection = buildMeetingsSection({
    upcomingMeetings: ctx.upcomingMeetings ?? [],
    allAgents: ctx.allAgents,
  });
  if (meetingsSection) sections.push(meetingsSection);

  if (ctx.activeSprint) {
    const s = ctx.activeSprint;
    sections.push(`# Active Sprint
- Name: ${s.name}
- Goal: ${s.goal || "No sprint goal set"}
- Period: ${s.startDate} to ${s.endDate}
- Status: ${s.status}
- Velocity: ${s.completedPoints}/${s.velocityPoints} points completed

Prioritize work that contributes to the sprint goal. Flag risks if the sprint goal is at risk.
`);
  }

  const knowledgeSection = buildKnowledgeSection(ctx.relevantKnowledge ?? []);
  if (knowledgeSection) sections.push(knowledgeSection);

  const docsSection = buildDocumentsSection({
    recentDocuments: ctx.recentDocuments ?? [],
    allAgents: ctx.allAgents,
  });
  if (docsSection) sections.push(docsSection);

  sections.push(`# Structured Output & Action Reporting
When you take actions via the API, report what you did in a structured format so the system can track your work.
After each API call that creates or modifies an entity, include the result in your summary:

Format your execution summary as:
  ACTIONS TAKEN:
  - [ACTION_TYPE] [ENTITY_TYPE] [ID]: [brief description]

Examples:
  ACTIONS TAKEN:
  - CREATED task TSK-abc123: "Implement user authentication" assigned to Alice
  - UPDATED task TSK-def456: status changed to "in_review" with review comment
  - CREATED project PRJ-ghi789: "Q1 Product Launch" under goal GOAL-xyz
  - SENT message to Bob (engineering): requesting API spec for integration
  - CREATED approval APR-123: secret_access for AWS credentials
  - CREATED document DOC-456: "Architecture Decision: Microservices vs Monolith"

This structured reporting helps the company track all agent actions and maintains a clear audit trail.
Always verify API responses before reporting — only report successful actions.
`);

  sections.push(`# Important Rules
- Company ID: ${ctx.agent.companyId}
- Your Agent ID: ${ctx.agent.id}
- Current Run ID: ${ctx.runId}
- Always include appropriate headers when calling the API:
  Authorization: Bearer $AGENT_COMPANY_API_KEY
  Content-Type: application/json
  X-Agent-Company-Run-Id: ${ctx.runId}
- Be concise and action-oriented. Focus on making progress.
- If your current task is already done, check for other assigned tasks.
- Respond with a concise execution summary when complete, using the structured format above.
- CRITICAL: Only work on the tasks and goals described above. Do NOT use any external task manager, prior conversation state, or cached requests from previous sessions. Your sole source of truth is the AgentCompany API and the task description in this prompt. Ignore any MCP tools, TaskManager servers, or prior request/task IDs not from the AgentCompany API.
- CRITICAL: Stay in the working directory you were started in. Do NOT cd or navigate to other projects or repositories.
- CRITICAL: Actually call the API to take actions. Do NOT just describe what you would do — DO it. Every wake cycle should result in at least one API call that moves work forward.
`);

  // Reinforce locale at the end of prompt (recency bias helps LLMs follow this)
  if (localeInstruction) {
    if ((ctx.locale ?? "en") === "zh") {
      sections.push(`# 语言要求提醒\n${localeInstruction}\n请记住：你的所有输出必须使用中文。\n`);
    } else {
      sections.push(`# Language Requirement Reminder\n${localeInstruction}\nRemember: ALL your output must be in English.\n`);
    }
  }

  return sections.join("\n");
}
