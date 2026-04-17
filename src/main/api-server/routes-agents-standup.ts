import type { AgentApiServer } from "./server-core";

export function registerAgentStandupRoute(server: AgentApiServer): void {
  const db = server.db;
  server.addRoute("GET", "/api/agents/me/standup", (_req, res, _params, token) => {
    const agent = db.getAgent(token.agentId);
    if (!agent || agent.companyId !== token.companyId) {
      server.json(res, 404, { error: "Agent not found" });
      return;
    }

    const directReports = db.listDirectReportsForStandup(token.companyId, token.agentId);

    const myTasks = db.listAssigneeTasksForStandup(token.companyId, token.agentId);

    const reportTasks = db.listTasksForAssignees(
      token.companyId,
      directReports.map((r) => r.id),
    );

    const reportStatusRows = directReports.length > 0
      ? db.listReportStatusesForStandup(token.companyId, token.agentId)
      : [];

    const tasksAwaitingMyReview = reportTasks.filter((t) => t.status === "in_review");
    const blockedReportTasks = reportTasks.filter((t) => t.status === "blocked");
    const myBlockedTasks = myTasks.filter((t) => t.status === "blocked");
    const myInProgressTasks = myTasks.filter((t) => t.status === "in_progress");
    const myTodoTasks = myTasks.filter((t) => t.status === "todo");

    const allRelevantTaskIds = new Set<string>([
      ...myTasks.map((t) => t.id),
      ...reportTasks.map((t) => t.id),
    ]);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const recentComments = db.listRecentTaskComments([...allRelevantTaskIds], twoHoursAgo, 20);

    const myPendingApprovals = db.listAgentPendingApprovals(token.companyId, token.agentId);
    const myResolvedApprovals = db.listAgentResolvedApprovals(token.companyId, token.agentId, 5);

    const reportNameMap = new Map(directReports.map((a) => [a.id, a.name]));
    const taskTitleMap = new Map<string, string>([
      ...myTasks.map<[string, string]>((t) => [t.id, t.title]),
      ...reportTasks.map<[string, string]>((t) => [t.id, t.title]),
    ]);
    const socialAccounts = db.listSocialAccounts(token.companyId);

    server.json(res, 200, {
      agent: { id: agent.id, name: agent.name, role: agent.role, status: agent.status },
      summary: {
        tasksAwaitingReview: tasksAwaitingMyReview.length,
        blockedReportTasks: blockedReportTasks.length,
        myBlockedTasks: myBlockedTasks.length,
        myInProgress: myInProgressTasks.length,
        myTodo: myTodoTasks.length,
        pendingApprovals: myPendingApprovals.length,
        directReports: directReports.length,
      },
      tasksAwaitingReview: tasksAwaitingMyReview.map((t) => ({
        id: t.id,
        title: t.title,
        assignee: reportNameMap.get(t.assigneeAgentId) ?? "Unknown",
        priority: t.priority,
      })),
      blockedTasks: [
        ...blockedReportTasks.map((t) => ({
          id: t.id,
          title: t.title,
          assignee: reportNameMap.get(t.assigneeAgentId) ?? "Unknown",
          priority: t.priority,
        })),
        ...myBlockedTasks.map((t) => ({
          id: t.id,
          title: t.title,
          assignee: agent.name,
          priority: t.priority,
        })),
      ],
      recentComments: recentComments.map((c) => ({
        taskId: c.taskId,
        taskTitle: taskTitleMap.get(c.taskId) ?? "",
        author: c.authorName,
        body: c.body.slice(0, 200),
        createdAt: c.createdAt,
      })),
      pendingApprovals: myPendingApprovals.map((a) => ({
        id: a.id,
        type: a.type,
        summary: a.payloadSummary,
        state: a.state,
      })),
      resolvedApprovals: myResolvedApprovals.map((a) => ({
        id: a.id,
        type: a.type,
        summary: a.payloadSummary,
        state: a.state,
        decisionNote: a.decisionNote,
      })),
      reportStatuses: reportStatusRows.map((r) => ({
        id: r.id,
        name: r.name,
        role: r.role,
        status: r.status,
        tasksInProgress: r.tasksInProgress,
        tasksInReview: r.tasksInReview,
        tasksBlocked: r.tasksBlocked,
        tasksDone: r.tasksDone,
      })),
      socialAccounts: socialAccounts.map((a) => ({
        id: a.id,
        platform: a.platform,
        accountName: a.accountName,
        displayName: a.displayName,
        status: a.status,
        requireApproval: a.requireApproval,
      })),
    });
  });
}
