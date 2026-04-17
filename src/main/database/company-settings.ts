import type { DatabaseSync } from "node:sqlite";
import type { ProfileSnapshot } from "@shared/types";
import {
  BOARD_READER_ID,
  type ReadAll,
  type Transaction,
} from "./helpers";

export function buildCompanySettingsMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  _transaction: Transaction,
  _deps: {
    listSnapshot: (options: { companyId?: string | null }) => ProfileSnapshot;
  },
) {
  return {
    /**
     * Returns the raw inputs for the GET /api/companies/:id/dashboard
     * endpoint: agent statuses, task statuses, and the last 20 activity rows.
     * Route code aggregates counts by status on top of this raw data.
     */
    getDashboardSnapshot(companyId: string): {
      agents: Array<{ id: string; status: string }>;
      tasks: Array<{ id: string; status: string }>;
      recentActivity: Array<{
        id: string;
        companyId: string;
        actor: string;
        action: string;
        entityType: string;
        entityId: string;
        detail: string | null;
        createdAt: string;
      }>;
    } {
      return {
        agents: readAll<{ id: string; status: string }>(
          "select id, status from agents where company_id = ?",
          companyId,
        ),
        tasks: readAll<{ id: string; status: string }>(
          "select id, status from tasks where company_id = ?",
          companyId,
        ),
        recentActivity: readAll<{
          id: string; companyId: string; actor: string; action: string;
          entityType: string; entityId: string; detail: string | null; createdAt: string;
        }>(
          "select id, company_id as companyId, actor, action, entity_type as entityType, entity_id as entityId, detail, created_at as createdAt from activity where company_id = ? order by created_at desc limit 20",
          companyId,
        ),
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
