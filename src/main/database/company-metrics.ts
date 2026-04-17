import type { DatabaseSync } from "node:sqlite";
import type {
  CompanyMetrics,
  AgentMetrics,
  RunStatus,
  StandupReport,
} from "@shared/types";
import { type ReadAll, type Transaction } from "./helpers";

/**
 * Dashboard-aggregate read queries extracted from company-settings.ts.
 * Covers getCompanyMetrics and getStandupReport. Every method is spread
 * into the final `buildCompanyMethods` result so AppDatabase call-sites
 * remain unchanged.
 */
export function buildCompanyMetricsMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  _transaction: Transaction,
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
      const db = getDb();
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      type AgentRow = {
        id: string; name: string; role: string; status: StandupReport["agentReports"][number]["status"];
        budgetMonthlyUsd: number; spentMonthlyUsd: number;
      };
      const agents = readAll<AgentRow>(
        `select id, name, role, status,
                budget_monthly_usd as budgetMonthlyUsd,
                spent_monthly_usd as spentMonthlyUsd
           from agents
          where company_id = ? and status != 'terminated' and status != 'pending_approval'
          order by created_at asc`,
        companyId,
      );

      const recentCompletedTasksCount = (db.prepare(
        "select count(*) as c from tasks where company_id = ? and status = 'done' and updated_at > ?",
      ).get(companyId, oneDayAgo) as { c: number }).c;

      const recentRunStats = db.prepare(
        `select
            count(*) as total,
            sum(case when status = 'succeeded' then 1 else 0 end) as succeeded,
            sum(case when status = 'failed' or status = 'timed_out' then 1 else 0 end) as failed
          from runs where company_id = ? and created_at > ?`,
      ).get(companyId, oneDayAgo) as { total: number; succeeded: number | null; failed: number | null };
      const recentRunsTotal = recentRunStats.total ?? 0;
      const successfulRuns = recentRunStats.succeeded ?? 0;
      const failedRuns = recentRunStats.failed ?? 0;

      const blockedTaskRows = readAll<{ id: string; title: string; assigneeAgentId: string | null }>(
        `select id, title, assignee_agent_id as assigneeAgentId
           from tasks where company_id = ? and status = 'blocked'`,
        companyId,
      );

      const pendingApprovals = (db.prepare(
        "select count(*) as c from approvals where company_id = ? and state = 'pending'",
      ).get(companyId) as { c: number }).c;

      const activeSprint = db.prepare(
        `select name, velocity_points as velocityPoints, completed_points as completedPoints
           from sprints where company_id = ? and status = 'active' order by start_date desc limit 1`,
      ).get(companyId) as { name: string; velocityPoints: number; completedPoints: number } | undefined;

      const urgentUnread = (db.prepare(
        `select count(*) as c
           from agent_messages messages
           left join agent_message_reads reads
             on reads.message_id = messages.id and reads.agent_id = '__board__'
          where messages.company_id = ?
            and reads.read_at is null
            and (messages.priority = 'urgent' or messages.channel = 'incident')`,
      ).get(companyId) as { c: number }).c;

      const tasksByAgentRows = readAll<{
        agentId: string; inProgress: number; blocked: number; completed24h: number;
      }>(
        `select assignee_agent_id as agentId,
                sum(case when status = 'in_progress' then 1 else 0 end) as inProgress,
                sum(case when status = 'blocked' then 1 else 0 end) as blocked,
                sum(case when status = 'done' and updated_at > ? then 1 else 0 end) as completed24h
           from tasks
          where company_id = ? and assignee_agent_id is not null
          group by assignee_agent_id`,
        oneDayAgo,
        companyId,
      );
      const tasksByAgent = new Map(tasksByAgentRows.map((row) => [row.agentId, row]));

      const recentRunsByAgent = readAll<{
        agentId: string; runCount: number; lastStatus: string | null; lastAt: string | null;
      }>(
        `select agent_id as agentId,
                count(*) as runCount,
                (select status from runs r2 where r2.agent_id = runs.agent_id and r2.company_id = runs.company_id and r2.created_at > ? order by created_at desc limit 1) as lastStatus,
                max(created_at) as lastAt
           from runs
          where company_id = ? and created_at > ?
          group by agent_id`,
        oneDayAgo,
        companyId,
        oneDayAgo,
      );
      const runsByAgent = new Map(recentRunsByAgent.map((row) => [row.agentId, row]));

      const costByAgentRows = readAll<{ agentId: string; cost24h: number }>(
        `select agent_id as agentId, coalesce(sum(amount_usd), 0) as cost24h
           from cost_entries
          where company_id = ? and agent_id is not null and created_at > ?
          group by agent_id`,
        companyId,
        oneDayAgo,
      );
      const costByAgent = new Map(costByAgentRows.map((row) => [row.agentId, row.cost24h]));

      const reviewByAgentRows = readAll<{ actor: string; cycles: number }>(
        `select actor, count(*) as cycles
           from activity
          where company_id = ? and created_at > ?
            and action in ('task.status_changed', 'task.updated', 'task.auto_assigned')
          group by actor`,
        companyId,
        oneDayAgo,
      );
      const reviewByAgent = new Map(reviewByAgentRows.map((row) => [row.actor, row.cycles]));

      const agentNameMap = new Map(agents.map((a) => [a.id, a.name]));

      const companyHighlights: string[] = [];
      const blockers: string[] = [];
      if (recentCompletedTasksCount > 0) {
        companyHighlights.push(`${recentCompletedTasksCount} task(s) completed in last 24h`);
      }
      if (recentRunsTotal > 0) {
        companyHighlights.push(
          `${recentRunsTotal} runs (${successfulRuns} succeeded, ${failedRuns} failed)`,
        );
      }
      for (const task of blockedTaskRows) {
        const assigneeName = task.assigneeAgentId ? agentNameMap.get(task.assigneeAgentId) ?? null : null;
        blockers.push(`${task.title} — blocked (${assigneeName ?? "unassigned"})`);
      }
      if (activeSprint) {
        const pct = activeSprint.velocityPoints > 0
          ? Math.round((activeSprint.completedPoints / activeSprint.velocityPoints) * 100)
          : 0;
        companyHighlights.push(
          `Sprint "${activeSprint.name}": ${activeSprint.completedPoints}/${activeSprint.velocityPoints} pts (${pct}%)`,
        );
      }
      if (urgentUnread > 0) {
        blockers.push(`${urgentUnread} urgent unread message(s) need attention`);
      }

      const totalBudget = agents.reduce((sum, a) => sum + a.budgetMonthlyUsd, 0);
      const totalSpent = agents.reduce((sum, a) => sum + a.spentMonthlyUsd, 0);
      const budgetUtilization = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

      const agentReports = agents.map((agent) => {
        const taskAgg = tasksByAgent.get(agent.id);
        const runAgg = runsByAgent.get(agent.id);
        const completed24h = taskAgg?.completed24h ?? 0;
        const runs24h = runAgg?.runCount ?? 0;
        const reviewedTasks = reviewByAgent.get(agent.id) ?? 0;
        const highlights: string[] = [];
        if (completed24h > 0) highlights.push(`Completed ${completed24h} task(s)`);
        if (runs24h > 0) highlights.push(`${runs24h} run(s) in last 24h`);
        if (reviewedTasks > 0) highlights.push(`${reviewedTasks} status update(s)`);
        return {
          agentId: agent.id,
          agentName: agent.name,
          role: agent.role,
          status: agent.status,
          tasksInProgress: taskAgg?.inProgress ?? 0,
          tasksCompleted24h: completed24h,
          tasksBlocked: taskAgg?.blocked ?? 0,
          lastRunStatus: (runAgg?.lastStatus ?? null) as RunStatus | null,
          lastRunAt: runAgg?.lastAt ?? null,
          costLast24h: costByAgent.get(agent.id) ?? 0,
          highlights,
        };
      });

      const summaryParts: string[] = [];
      if (agents.length > 0) summaryParts.push(`${agents.length} active agents`);
      summaryParts.push(`${recentCompletedTasksCount} tasks done`);
      if (blockedTaskRows.length > 0) summaryParts.push(`${blockedTaskRows.length} blocked`);
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
  };
}
