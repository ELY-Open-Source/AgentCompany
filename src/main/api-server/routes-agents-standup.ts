import type { AgentApiServer } from "./server-core";

type DirectReportRow = {
  id: string; name: string; role: string; status: string;
};

type MyTaskRow = {
  id: string; title: string; status: string; priority: string;
};

type ReportTaskRow = {
  id: string; title: string; status: string; priority: string;
  assigneeAgentId: string;
};

type ApprovalRow = {
  id: string; type: string; state: string;
  payloadSummary: string | null; decisionNote: string | null;
};

type TaskCommentRow = {
  id: string; taskId: string; authorName: string;
  body: string; createdAt: string;
};

type ReportStatusRow = {
  id: string; name: string; role: string; status: string;
  tasksInProgress: number; tasksInReview: number;
  tasksBlocked: number; tasksDone: number;
};

export function registerAgentStandupRoute(server: AgentApiServer): void {
  const db = server.db;
  server.addRoute("GET", "/api/agents/me/standup", (_req, res, _params, token) => {
    const agent = db.getAgent(token.agentId);
    if (!agent || agent.companyId !== token.companyId) {
      server.json(res, 404, { error: "Agent not found" });
      return;
    }

    const directReports = db.queryAll<DirectReportRow>(
      `select id, name, role, status from agents
        where company_id = ? and reports_to = ?
        order by created_at asc`,
      token.companyId,
      token.agentId,
    );

    const myTasks = db.queryAll<MyTaskRow>(
      `select id, title, status, priority from tasks
        where company_id = ? and assignee_agent_id = ?
        order by created_at desc`,
      token.companyId,
      token.agentId,
    );

    const reportTasks = directReports.length > 0
      ? db.queryAll<ReportTaskRow>(
          `select id, title, status, priority, assignee_agent_id as assigneeAgentId
             from tasks
            where company_id = ?
              and assignee_agent_id in (${directReports.map(() => "?").join(",")})
            order by created_at desc`,
          token.companyId,
          ...directReports.map((r) => r.id),
        )
      : [];

    const reportStatusRows = directReports.length > 0
      ? db.queryAll<ReportStatusRow>(
          `select agents.id as id, agents.name as name, agents.role as role, agents.status as status,
                  coalesce(sum(case when tasks.status = 'in_progress' then 1 else 0 end), 0) as tasksInProgress,
                  coalesce(sum(case when tasks.status = 'in_review' then 1 else 0 end), 0) as tasksInReview,
                  coalesce(sum(case when tasks.status = 'blocked' then 1 else 0 end), 0) as tasksBlocked,
                  coalesce(sum(case when tasks.status = 'done' then 1 else 0 end), 0) as tasksDone
             from agents
             left join tasks on tasks.assignee_agent_id = agents.id and tasks.company_id = agents.company_id
            where agents.company_id = ? and agents.reports_to = ?
            group by agents.id, agents.name, agents.role, agents.status
            order by agents.created_at asc`,
          token.companyId,
          token.agentId,
        )
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
    const recentComments = allRelevantTaskIds.size > 0
      ? db.queryAll<TaskCommentRow>(
          `select id, task_id as taskId, author_name as authorName, body, created_at as createdAt
             from task_comments
            where task_id in (${[...allRelevantTaskIds].map(() => "?").join(",")})
              and created_at > ?
            order by created_at desc limit 20`,
          ...[...allRelevantTaskIds], twoHoursAgo,
        )
      : [];

    const myPendingApprovals = db.queryAll<ApprovalRow>(
      `select id, type, state, payload_summary as payloadSummary, decision_note as decisionNote
         from approvals
        where company_id = ? and requested_by_agent_id = ? and state = 'pending'
        order by created_at desc`,
      token.companyId,
      token.agentId,
    );
    const myResolvedApprovals = db.queryAll<ApprovalRow>(
      `select id, type, state, payload_summary as payloadSummary, decision_note as decisionNote
         from approvals
        where company_id = ? and requested_by_agent_id = ? and state != 'pending'
        order by created_at desc limit 5`,
      token.companyId,
      token.agentId,
    );

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
