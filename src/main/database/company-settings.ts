import type { DatabaseSync } from "node:sqlite";
import type {
  CompanyMetrics,
  AgentMetrics,
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
      const snapshot = deps.listSnapshot({ companyId });
      const agents = snapshot.agents;
      const tasks = snapshot.tasks;
      const runs = snapshot.runs;
      const costs = snapshot.costs;

      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const recentRuns = runs.filter((r) => r.createdAt > cutoff);
      const recentTasks = tasks.filter((t) => t.status === "done" && t.updatedAt > cutoff);

      const successfulRuns = recentRuns.filter((r) => r.status === "succeeded").length;
      const failedRuns = recentRuns.filter(
        (r) => r.status === "failed" || r.status === "timed_out",
      ).length;
      const totalCost = costs.reduce((sum, c) => sum + (c.amountUsd ?? 0), 0);
      const completedTasks = tasks.filter((t) => t.status === "done").length;

      const agentMetrics: AgentMetrics[] = agents
        .filter((a) => a.status !== "pending_approval" && a.status !== "terminated")
        .map((agent) => {
          const agentTasks = tasks.filter((t) => t.assigneeAgentId === agent.id);
          const agentRuns = runs.filter((r) => r.agentId === agent.id);
          const agentRecentRuns = agentRuns.filter((r) => r.createdAt > cutoff);
          const agentCosts = costs.filter((c) => c.agentId === agent.id);

          const agentSucceeded = agentRecentRuns.filter((r) => r.status === "succeeded").length;
          const agentFailed = agentRecentRuns.filter(
            (r) => r.status === "failed" || r.status === "timed_out",
          ).length;

          // Avg run duration
          const finishedRuns = agentRuns.filter((r) => r.startedAt && r.finishedAt);
          const avgDuration =
            finishedRuns.length > 0
              ? finishedRuns.reduce(
                  (sum, r) =>
                    sum +
                    (new Date(r.finishedAt!).getTime() - new Date(r.startedAt!).getTime()) / 1000,
                  0,
                ) / finishedRuns.length
              : 0;

          // Review cycles: count task status transitions by this agent
          // Actual action strings: "task.status_changed" (api-server), "task.updated" (index.ts), "task.auto_assigned" (database)
          const reviewCycles = snapshot.activity.filter(
            (a) =>
              a.companyId === companyId &&
              a.actor === agent.id &&
              (a.action === "task.status_changed" ||
                a.action === "task.updated" ||
                a.action === "task.auto_assigned"),
          ).length;

          const lastRun = agentRuns.sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )[0];

          return {
            agentId: agent.id,
            agentName: agent.name,
            tasksCompleted: agentTasks.filter((t) => t.status === "done").length,
            tasksAssigned: agentTasks.filter(
              (t) => t.status !== "done" && t.status !== "cancelled",
            ).length,
            tasksFailed: agentTasks.filter((t) => t.status === "cancelled").length,
            successRate:
              agentRecentRuns.length > 0
                ? Math.round((agentSucceeded / agentRecentRuns.length) * 100)
                : 0,
            avgRunDurationSec: Math.round(avgDuration),
            totalCostUsd: agentCosts.reduce((sum, c) => sum + (c.amountUsd ?? 0), 0),
            runsTotal: agentRecentRuns.length,
            runsSucceeded: agentSucceeded,
            runsFailed: agentFailed,
            reviewCycles,
            lastActiveAt: lastRun?.createdAt ?? null,
          };
        });

      return {
        totalAgents: agents.filter(
          (a) => a.status !== "pending_approval" && a.status !== "terminated",
        ).length,
        activeAgents: agents.filter((a) => a.status === "active" || a.status === "running").length,
        totalTasks: tasks.length,
        completedTasks,
        blockedTasks: tasks.filter((t) => t.status === "blocked").length,
        totalRuns: recentRuns.length,
        successfulRuns,
        failedRuns,
        overallSuccessRate:
          recentRuns.length > 0 ? Math.round((successfulRuns / recentRuns.length) * 100) : 0,
        totalCostUsd: totalCost,
        avgCostPerTask: completedTasks > 0 ? totalCost / completedTasks : 0,
        throughputTasksPerDay: days > 0 ? recentTasks.length / days : 0,
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
