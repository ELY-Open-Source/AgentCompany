import { DEPARTMENT_LABELS } from "@shared/constants";
import type { DepartmentId } from "@shared/types";
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
import { roleMatchesLeadershipKeywords } from "../agent-role-helpers";
import { getSystemMessages } from "./messages";
import type { SystemMessages } from "./messages";

function isLeadershipRole(ctx: PromptContext): boolean {
  // HR roles inherit leadership scope for manager-style prompts;
  // other departments rely on role/title keyword tokenization.
  if (ctx.agent.department === "hr") return true;
  return roleMatchesLeadershipKeywords(ctx.agent.role, ctx.agent.title ?? null);
}

function buildSkillManifest(
  m: SystemMessages,
  skillEntries?: PromptContext["skillEntries"],
  skillNames?: string[],
): string {
  if (skillEntries && skillEntries.length > 0) return m.skillManifestEntries(skillEntries);
  if (skillNames && skillNames.length > 0) return m.skillManifestNames(skillNames);
  return "";
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const m = getSystemMessages(ctx.locale);
  const sections: string[] = [];

  const isCEO = ctx.chainOfCommand.length === 0;
  const isManager = !isCEO && (ctx.directReports.length > 0 || isLeadershipRole(ctx));

  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const timeStr = now.toISOString().split("T")[1]?.slice(0, 5) ?? "00:00";
  const dayOfWeek = m.dayNames[now.getUTCDay()] ?? "";
  sections.push(m.currentDateSection(dayOfWeek, dateStr, timeStr));

  const budgetPct = ctx.agent.budgetMonthlyUsd > 0
    ? Math.round((ctx.agent.spentMonthlyUsd / ctx.agent.budgetMonthlyUsd) * 100)
    : null;
  sections.push(m.agentIdentitySection({
    name: ctx.agent.name,
    role: ctx.agent.role,
    title: ctx.agent.title || null,
    companyName: ctx.companyName,
    capabilities: ctx.agent.capabilities,
    budgetMonthly: ctx.agent.budgetMonthlyUsd,
    spentMonthly: ctx.agent.spentMonthlyUsd,
    budgetPctUsed: budgetPct,
    skillManifest: buildSkillManifest(m, ctx.skillEntries, ctx.skillNames),
  }));

  const capabilityRegistrySection = buildCapabilityRegistrySection({
    companySkillCatalog: ctx.companySkillCatalog,
    companyWorkspaces: ctx.companyWorkspaces,
    allConnectors: ctx.allConnectors,
    companyDocuments: ctx.companyDocuments,
  });
  if (capabilityRegistrySection) sections.push(capabilityRegistrySection);

  if (ctx.companyDescription) sections.push(m.companyMissionSection(ctx.companyDescription));

  if (ctx.executionMode === "ai_cofounder") {
    sections.push(m.executionModeAiCofounderSection(ctx.agent.companyId));
  }

  sections.push(m.cognitiveFrameworkSection);

  if (isCEO) sections.push(m.ceoLeadershipStyleSection);
  else if (isManager) sections.push(m.managementStyleSection);
  else sections.push(m.icWorkPhilosophySection);

  if (ctx.chainOfCommand.length > 0) {
    const chainStr = ctx.chainOfCommand
      .map((a) => m.chainOfCommandLine(a.name, a.role))
      .join(m.chainOfCommandSeparator);
    sections.push(m.chainOfCommandSection(chainStr));
  } else {
    sections.push(m.topPositionSection);
  }

  if (ctx.directReports.length > 0) {
    const lines = ctx.directReports
      .map((a) => m.directReportLine({
        name: a.name,
        role: a.role,
        title: a.title || null,
        capabilities: a.capabilities,
        status: a.status,
        connectorId: a.connectorId,
      }))
      .join("\n");
    sections.push(m.directReportsSection(lines));

    const workloadLines = ctx.directReports.map((report) => {
      const reportTasks = ctx.allTasks.filter((t) => t.assigneeAgentId === report.id);
      const inProgress = reportTasks.filter((t) => t.status === "in_progress").length;
      const inReview = reportTasks.filter((t) => t.status === "in_review").length;
      const blocked = reportTasks.filter((t) => t.status === "blocked").length;
      const todo = reportTasks.filter((t) => t.status === "todo").length;
      return m.teamWorkloadLine(report.name, report.role, inProgress, inReview, blocked, todo);
    }).join("\n");
    sections.push(m.teamWorkloadSection(workloadLines));
  }

  if (ctx.agent.department) {
    const deptLabel = DEPARTMENT_LABELS[ctx.agent.department] ?? ctx.agent.department;
    const deptMembers = ctx.allAgents.filter(
      (a) => a.department === ctx.agent.department && a.id !== ctx.agent.id && a.status !== "terminated",
    );
    const memberLines = deptMembers.map((a) => m.deptColleagueLine(a.name, a.role, a.status)).join("\n");
    sections.push(m.departmentMembersSection(deptLabel, memberLines));
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
        return m.companyDeptMapLine(label, members.length, members.map((x) => x.name).join(", "));
      }).join("\n");
      sections.push(m.companyDepartmentMapSection(deptLines));
    }
  }

  const activeGoals = ctx.goals.filter((g) => g.status === "active" || g.status === "planned");
  if (activeGoals.length > 0) {
    const lines = activeGoals.map((g) => m.activeGoalLine(g.id, g.title, g.description, g.status, g.ownerAgentId === ctx.agent.id)).join("\n");
    sections.push(m.activeGoalsSection(lines));
  }

  const relevantProjects = ctx.projects.filter((p) =>
    p.status === "in_progress" || p.status === "planned" || p.leadAgentId === ctx.agent.id,
  );
  if (relevantProjects.length > 0) {
    const lines = relevantProjects.map((p) => m.projectLine(p.id, p.name, p.description, p.status, p.leadAgentId === ctx.agent.id)).join("\n");
    sections.push(m.projectsSection(lines));
  }

  if (ctx.sessionHandoff) sections.push(m.sessionHandoffSection(ctx.sessionHandoff));

  if (ctx.task) {
    sections.push(buildTaskSection({
      task: ctx.task,
      agent: { id: ctx.agent.id, companyId: ctx.agent.companyId, department: ctx.agent.department },
      projects: ctx.projects,
      goals: ctx.goals,
    }));
  }

  if (ctx.assignedTasks.length > 0) {
    const lines = ctx.assignedTasks.map((t) => m.assignedTaskLine(t.id, t.title, t.status, t.priority)).join("\n");
    sections.push(m.assignedTasksSection(lines));
  }

  const reviewSection = buildReviewSection({
    tasksAwaitingReview: ctx.tasksAwaitingReview,
    allAgents: ctx.allAgents,
    recentComments: ctx.recentComments,
  });
  if (reviewSection) sections.push(reviewSection);

  const approvalsSection = buildPendingApprovalsSection(ctx.pendingApprovals);
  if (approvalsSection) sections.push(approvalsSection);

  sections.push(buildSOPSection(ctx.locale));
  sections.push(buildAPISection(ctx));

  if (ctx.recentComments.length > 0) {
    const lines = ctx.recentComments.slice(0, 10)
      .map((c) => m.recentCommentLine(c.taskTitle, c.authorName, c.body))
      .join("\n");
    sections.push(m.recentCommentsSection(lines));
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
    sections.push(m.activeSprintSection({
      name: s.name,
      goal: s.goal || "",
      startDate: s.startDate,
      endDate: s.endDate,
      status: s.status,
      completedPoints: s.completedPoints,
      velocityPoints: s.velocityPoints,
    }));
  }

  const knowledgeSection = buildKnowledgeSection(ctx.relevantKnowledge ?? []);
  if (knowledgeSection) sections.push(knowledgeSection);

  const docsSection = buildDocumentsSection({
    recentDocuments: ctx.recentDocuments ?? [],
    allAgents: ctx.allAgents,
  });
  if (docsSection) sections.push(docsSection);

  sections.push(m.structuredOutputSection);
  sections.push(m.importantRulesSection(ctx.agent.companyId, ctx.agent.id, ctx.runId));

  return sections.join("\n");
}
