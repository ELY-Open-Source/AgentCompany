import type { DatabaseSync } from "node:sqlite";
import type {
  CompanyMetrics,
  AgentMetrics,
  InboxItem,
  ProfileSnapshot,
  RunStatus,
  StandupReport,
} from "@shared/types";
import {
  type ReadAll,
  type Transaction,
} from "./helpers";

export function buildCompanySettingsMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
  deps: {
    listSnapshot: (options: { companyId?: string | null }) => ProfileSnapshot;
  },
) {
  return {
    getCompanyMetrics(companyId: string, days: number = 30): CompanyMetrics {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const db = getDb();

      const agentRows = readAll<{
        id: string; name: string; status: string;
      }>(
        `select id, name, status from agents where company_id = ? order by created_at asc`,
        companyId,
      );
      const activeAgentRows = agentRows.filter(
        (a) => a.status !== "pending_approval" && a.status !== "terminated",
      );

      const totalAgents = activeAgentRows.length;
      const activeAgents = agentRows.filter(
        (a) => a.status === "active" || a.status === "running",
      ).length;

      const totalTasks = (db.prepare(
        "select count(*) as c from tasks where company_id = ?",
      ).get(companyId) as { c: number }).c;
      const completedTasks = (db.prepare(
        "select count(*) as c from tasks where company_id = ? and status = 'done'",
      ).get(companyId) as { c: number }).c;
      const blockedTasks = (db.prepare(
        "select count(*) as c from tasks where company_id = ? and status = 'blocked'",
      ).get(companyId) as { c: number }).c;

      const recentRunStats = db.prepare(
        `select
            count(*) as totalRuns,
            sum(case when status = 'succeeded' then 1 else 0 end) as successful,
            sum(case when status = 'failed' or status = 'timed_out' then 1 else 0 end) as failed
          from runs where company_id = ? and created_at > ?`,
      ).get(companyId, cutoff) as { totalRuns: number; successful: number | null; failed: number | null };
      const totalRuns = recentRunStats.totalRuns ?? 0;
      const successfulRuns = recentRunStats.successful ?? 0;
      const failedRuns = recentRunStats.failed ?? 0;

      const totalCost = (db.prepare(
        "select coalesce(sum(amount_usd), 0) as s from cost_entries where company_id = ?",
      ).get(companyId) as { s: number }).s;

      const recentTasksDone = (db.prepare(
        "select count(*) as c from tasks where company_id = ? and status = 'done' and updated_at > ?",
      ).get(companyId, cutoff) as { c: number }).c;

      const taskAggRows = readAll<{
        agentId: string;
        done: number;
        assigned: number;
        cancelled: number;
      }>(
        `select assignee_agent_id as agentId,
                sum(case when status = 'done' then 1 else 0 end) as done,
                sum(case when status != 'done' and status != 'cancelled' then 1 else 0 end) as assigned,
                sum(case when status = 'cancelled' then 1 else 0 end) as cancelled
           from tasks
          where company_id = ? and assignee_agent_id is not null
          group by assignee_agent_id`,
        companyId,
      );
      const taskAggMap = new Map(taskAggRows.map((row) => [row.agentId, row]));

      const runRecentAggRows = readAll<{
        agentId: string;
        total: number;
        succeeded: number;
        failed: number;
      }>(
        `select agent_id as agentId,
                count(*) as total,
                sum(case when status = 'succeeded' then 1 else 0 end) as succeeded,
                sum(case when status = 'failed' or status = 'timed_out' then 1 else 0 end) as failed
           from runs
          where company_id = ? and created_at > ?
          group by agent_id`,
        companyId,
        cutoff,
      );
      const runRecentAggMap = new Map(runRecentAggRows.map((row) => [row.agentId, row]));

      const runDurationRows = readAll<{
        agentId: string;
        avgDurationSec: number | null;
        lastActiveAt: string | null;
      }>(
        `select agent_id as agentId,
                avg((julianday(finished_at) - julianday(started_at)) * 86400.0) as avgDurationSec,
                max(created_at) as lastActiveAt
           from runs
          where company_id = ? and started_at is not null and finished_at is not null
          group by agent_id`,
        companyId,
      );
      const runDurationMap = new Map(runDurationRows.map((row) => [row.agentId, row]));

      const lastActiveRows = readAll<{ agentId: string; lastActiveAt: string }>(
        `select agent_id as agentId, max(created_at) as lastActiveAt
           from runs where company_id = ? group by agent_id`,
        companyId,
      );
      const lastActiveMap = new Map(lastActiveRows.map((row) => [row.agentId, row.lastActiveAt]));

      const costAggRows = readAll<{ agentId: string; totalCost: number }>(
        `select agent_id as agentId, coalesce(sum(amount_usd), 0) as totalCost
           from cost_entries where company_id = ? and agent_id is not null
          group by agent_id`,
        companyId,
      );
      const costAggMap = new Map(costAggRows.map((row) => [row.agentId, row.totalCost]));

      const reviewCycleRows = readAll<{ actor: string; cycles: number }>(
        `select actor, count(*) as cycles
           from activity
          where company_id = ?
            and action in ('task.status_changed', 'task.updated', 'task.auto_assigned')
          group by actor`,
        companyId,
      );
      const reviewCycleMap = new Map(reviewCycleRows.map((row) => [row.actor, row.cycles]));

      const agentMetrics: AgentMetrics[] = activeAgentRows.map((agent) => {
        const taskAgg = taskAggMap.get(agent.id);
        const runRecent = runRecentAggMap.get(agent.id);
        const runDur = runDurationMap.get(agent.id);
        const succeeded = runRecent?.succeeded ?? 0;
        const total = runRecent?.total ?? 0;
        return {
          agentId: agent.id,
          agentName: agent.name,
          tasksCompleted: taskAgg?.done ?? 0,
          tasksAssigned: taskAgg?.assigned ?? 0,
          tasksFailed: taskAgg?.cancelled ?? 0,
          successRate: total > 0 ? Math.round((succeeded / total) * 100) : 0,
          avgRunDurationSec: Math.round(runDur?.avgDurationSec ?? 0),
          totalCostUsd: costAggMap.get(agent.id) ?? 0,
          runsTotal: total,
          runsSucceeded: succeeded,
          runsFailed: runRecent?.failed ?? 0,
          reviewCycles: reviewCycleMap.get(agent.id) ?? 0,
          lastActiveAt: lastActiveMap.get(agent.id) ?? null,
        };
      });

      return {
        totalAgents,
        activeAgents,
        totalTasks,
        completedTasks,
        blockedTasks,
        totalRuns,
        successfulRuns,
        failedRuns,
        overallSuccessRate: totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : 0,
        totalCostUsd: totalCost,
        avgCostPerTask: completedTasks > 0 ? totalCost / completedTasks : 0,
        throughputTasksPerDay: days > 0 ? recentTasksDone / days : 0,
        agentMetrics,
      };
    },

    getStandupReport(companyId: string): StandupReport {
      const snapshot = deps.listSnapshot({ companyId });
      const agents = snapshot.agents.filter(
        (a) => a.status !== "terminated" && a.status !== "pending_approval",
      );
      const tasks = snapshot.tasks;
      const runs = snapshot.runs;
      const costs = snapshot.costs;

      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const recentActivity = snapshot.activity.filter(
        (a) => a.companyId === companyId && a.createdAt > oneDayAgo,
      );

      const companyHighlights: string[] = [];
      const blockers: string[] = [];

      const recentCompletedTasks = tasks.filter(
        (t) => t.status === "done" && t.updatedAt > oneDayAgo,
      );
      if (recentCompletedTasks.length > 0) {
        companyHighlights.push(`${recentCompletedTasks.length} task(s) completed in last 24h`);
      }

      const recentRuns = runs.filter((r) => r.createdAt > oneDayAgo);
      const successfulRuns = recentRuns.filter((r) => r.status === "succeeded").length;
      const failedRuns = recentRuns.filter(
        (r) => r.status === "failed" || r.status === "timed_out",
      ).length;
      if (recentRuns.length > 0) {
        companyHighlights.push(
          `${recentRuns.length} runs (${successfulRuns} succeeded, ${failedRuns} failed)`,
        );
      }

      const blockedTasks = tasks.filter((t) => t.status === "blocked");
      for (const task of blockedTasks) {
        const assignee = agents.find((a) => a.id === task.assigneeAgentId);
        blockers.push(`${task.title} — blocked (${assignee?.name ?? "unassigned"})`);
      }

      const pendingApprovals = snapshot.approvals.filter(
        (a) => a.companyId === companyId && a.state === "pending",
      ).length;
      const totalBudget = agents.reduce((sum, a) => sum + a.budgetMonthlyUsd, 0);
      const totalSpent = agents.reduce((sum, a) => sum + a.spentMonthlyUsd, 0);
      const budgetUtilization =
        totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

      // Active sprint progress
      const activeSprint = snapshot.sprints.find(
        (s) => s.companyId === companyId && s.status === "active",
      );
      if (activeSprint) {
        const pct =
          activeSprint.velocityPoints > 0
            ? Math.round(
                (activeSprint.completedPoints / activeSprint.velocityPoints) * 100,
              )
            : 0;
        companyHighlights.push(
          `Sprint "${activeSprint.name}": ${activeSprint.completedPoints}/${activeSprint.velocityPoints} pts (${pct}%)`,
        );
      }

      // Unread messages requiring attention
      const urgentUnread = snapshot.agentMessages.filter(
        (m) =>
          m.companyId === companyId &&
          !m.readAt &&
          (m.priority === "urgent" || m.channel === "incident"),
      ).length;
      if (urgentUnread > 0) {
        blockers.push(`${urgentUnread} urgent unread message(s) need attention`);
      }

      const agentReports = agents.map((agent) => {
        const agentTasks = tasks.filter((t) => t.assigneeAgentId === agent.id);
        const agentRuns = runs.filter((r) => r.agentId === agent.id);
        const agentRecentRuns = agentRuns.filter((r) => r.createdAt > oneDayAgo);
        const agentCosts = costs.filter(
          (c) => c.agentId === agent.id && c.createdAt > oneDayAgo,
        );
        const lastRun = agentRecentRuns.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )[0];

        const highlights: string[] = [];
        const completedRecently = agentTasks.filter(
          (t) => t.status === "done" && t.updatedAt > oneDayAgo,
        );
        if (completedRecently.length > 0)
          highlights.push(`Completed ${completedRecently.length} task(s)`);
        if (agentRecentRuns.length > 0)
          highlights.push(`${agentRecentRuns.length} run(s) in last 24h`);
        const reviewedTasks = recentActivity.filter(
          (a) =>
            a.actor === agent.id &&
            (a.action === "task.status_changed" ||
              a.action === "task.updated" ||
              a.action === "task.auto_assigned"),
        ).length;
        if (reviewedTasks > 0) highlights.push(`${reviewedTasks} status update(s)`);

        return {
          agentId: agent.id,
          agentName: agent.name,
          role: agent.role,
          status: agent.status,
          tasksInProgress: agentTasks.filter((t) => t.status === "in_progress").length,
          tasksCompleted24h: completedRecently.length,
          tasksBlocked: agentTasks.filter((t) => t.status === "blocked").length,
          lastRunStatus: (lastRun?.status ?? null) as RunStatus | null,
          lastRunAt: lastRun?.createdAt ?? null,
          costLast24h: agentCosts.reduce((sum, c) => sum + (c.amountUsd ?? 0), 0),
          highlights,
        };
      });

      const summaryParts: string[] = [];
      if (agents.length > 0) summaryParts.push(`${agents.length} active agents`);
      summaryParts.push(`${recentCompletedTasks.length} tasks done`);
      if (blockedTasks.length > 0) summaryParts.push(`${blockedTasks.length} blocked`);
      if (pendingApprovals > 0) summaryParts.push(`${pendingApprovals} pending approvals`);

      return {
        companyId,
        generatedAt: new Date().toISOString(),
        summary: summaryParts.join(" · "),
        agentReports,
        companyHighlights,
        blockers,
        pendingApprovals,
        budgetUtilization,
      };
    },

    getSidebarBadges(companyId: string): {
      pendingApprovals: number;
      activeRuns: number;
      failedRuns: number;
      todoTasks: number;
      budgetWarnings: number;
      unreadMessages: number;
    } {
      const BOARD_READER_ID = "__board__";
      const pendingApprovals =
        (
          getDb()
            .prepare(
              "select count(*) as c from approvals where company_id = ? and state = 'pending'",
            )
            .get(companyId) as { c: number }
        )?.c ?? 0;
      const activeRuns =
        (
          getDb()
            .prepare(
              "select count(*) as c from runs where company_id = ? and status in ('queued', 'running')",
            )
            .get(companyId) as { c: number }
        )?.c ?? 0;
      const failedRuns =
        (
          getDb()
            .prepare(
              "select count(*) as c from runs where company_id = ? and status in ('failed', 'timed_out', 'interrupted')",
            )
            .get(companyId) as { c: number }
        )?.c ?? 0;
      const todoTasks =
        (
          getDb()
            .prepare(
              "select count(*) as c from tasks where company_id = ? and status in ('todo', 'in_progress', 'in_review')",
            )
            .get(companyId) as { c: number }
        )?.c ?? 0;
      const budgetWarnings =
        (
          getDb()
            .prepare(
              "select count(*) as c from agents where company_id = ? and budget_monthly_usd > 0 and (spent_monthly_usd * 1.0 / budget_monthly_usd) >= 0.8",
            )
            .get(companyId) as { c: number }
        )?.c ?? 0;
      const unreadMessages =
        (
          getDb()
            .prepare(
              `select count(*) as c
           from agent_messages messages
           left join agent_message_reads reads
             on reads.message_id = messages.id
            and reads.agent_id = ?
          where messages.company_id = ?
            and reads.read_at is null
            and (messages.channel = 'company' or messages.channel = 'incident' or messages.priority = 'urgent')`,
            )
            .get(BOARD_READER_ID, companyId) as { c: number }
        )?.c ?? 0;
      return { pendingApprovals, activeRuns, failedRuns, todoTasks, budgetWarnings, unreadMessages };
    },
  };
}
