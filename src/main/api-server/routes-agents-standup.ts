import type { AgentApiServer } from "./server-core";

export function registerAgentStandupRoute(server: AgentApiServer): void {
  const db = server.db;
  server.addRoute("GET", "/api/agents/me/standup", (_req, res, _params, token) => {
    const agent = db.entityCrud.getAgent(token.agentId);
    if (!agent || agent.companyId !== token.companyId) {
      server.json(res, 404, { error: "Agent not found" });
      return;
    }

    const directReports = db.agents.listDirectReportsForStandup(token.companyId, token.agentId);

    const myTasks = db.tasks.listAssigneeTasksForStandup(token.companyId, token.agentId);

    const reportTasks = db.tasks.listTasksForAssignees(
      token.companyId,
      directReports.map((r) => r.id),
    );

    const reportStatusRows = directReports.length > 0
      ? db.agents.listReportStatusesForStandup(token.companyId, token.agentId)
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

    // Unread inbox lives in the standup briefing as the agent's
    // canonical view of pending communication. Pre-fix the agent had
    // to make a second API call to /messages?unreadOnly=true that the
    // model frequently skipped, so messages from peers and managers
    // sat dark while the agent posted heartbeat status comments.
    const unreadInbox = db.listAgentInboxUnread(token.companyId, token.agentId);
    const senderIds = new Set(unreadInbox.map((m) => m.fromAgentId));
    const senderNames = senderIds.size > 0
      ? new Map(db.agents.listAgentNamesByIds(token.companyId, Array.from(senderIds)).map((row) => [row.id, row.name]))
      : new Map<string, string>();

    // Recent outputs the AGENT itself produced — closes the
    // trust-but-verify loop. Without this view the model could
    // narrate "I wrote the spec doc" in its assistant text without
    // ever calling the persistence API, and we'd never catch it.
    // Filter scope: documents the agent authored, work_products on
    // any task the agent has worked on (assigned tasks). Taskless
    // run outputs are intentionally out of scope here — the smaller
    // surface keeps the briefing readable.
    const RECENT_OUTPUT_LIMIT = 20;
    const myTaskIds = new Set(myTasks.map((t) => t.id));
    const recentDocuments = db.listDocuments(token.companyId)
      .filter((doc) => doc.authorAgentId === token.agentId)
      .slice(0, RECENT_OUTPUT_LIMIT);
    const recentWorkProducts = db.listWorkProductsForCompany(token.companyId)
      .filter((wp) => wp.taskId !== null && myTaskIds.has(wp.taskId))
      .slice(0, RECENT_OUTPUT_LIMIT);

    const reportNameMap = new Map(directReports.map((a) => [a.id, a.name]));
    const taskTitleMap = new Map<string, string>([
      ...myTasks.map<[string, string]>((t) => [t.id, t.title]),
      ...reportTasks.map<[string, string]>((t) => [t.id, t.title]),
    ]);
    const socialAccounts = db.listSocialAccounts(token.companyId);

    server.json(res, 200, {
      agent: { id: agent.id, name: agent.name, role: agent.role, status: agent.status },
      summary: {
        unreadMessages: unreadInbox.length,
        tasksAwaitingReview: tasksAwaitingMyReview.length,
        blockedReportTasks: blockedReportTasks.length,
        myBlockedTasks: myBlockedTasks.length,
        myInProgress: myInProgressTasks.length,
        myTodo: myTodoTasks.length,
        pendingApprovals: myPendingApprovals.length,
        directReports: directReports.length,
      },
      unreadMessages: unreadInbox.map((m) => ({
        id: m.id,
        from: senderNames.get(m.fromAgentId) ?? m.fromAgentId,
        fromAgentId: m.fromAgentId,
        channel: m.channel,
        channelTargetId: m.channelTargetId,
        subject: m.subject,
        bodyPreview: m.body.slice(0, 240),
        priority: m.priority,
        parentMessageId: m.parentMessageId,
        createdAt: m.createdAt,
      })),
      recentDocuments: recentDocuments.map((d) => ({
        id: d.id,
        type: d.type,
        title: d.title,
        status: d.status,
        version: d.version,
        updatedAt: d.updatedAt,
      })),
      recentWorkProducts: recentWorkProducts.map((wp) => ({
        id: wp.id,
        type: wp.type,
        provider: wp.provider,
        title: wp.title,
        externalId: wp.externalId,
        url: wp.url,
        status: wp.status,
        taskId: wp.taskId,
        taskTitle: wp.taskId ? (taskTitleMap.get(wp.taskId) ?? "") : "",
        updatedAt: wp.updatedAt,
      })),
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
