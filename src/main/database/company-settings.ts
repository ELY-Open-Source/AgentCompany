import type { DatabaseSync } from "node:sqlite";
import type { ProfileSnapshot } from "@shared/types";
import type { ReadAll, Transaction } from "./helpers";

/**
 * Company-scoped read endpoints that do not belong to a single domain
 * CRUD module.
 *
 * Sidebar badges used to live here as a server-side aggregation
 * (`getSidebarBadges`) — it has been deleted. The desktop app is
 * local-first and the renderer already holds every row the badges
 * would count via `ProfileSnapshot`, so the aggregation became a
 * second source of truth that drifted from the inbox query whenever
 * messages were read between snapshot refreshes. Derivation now lives
 * in `src/shared/sidebar-badges.ts::deriveSidebarBadges`.
 */
export function buildCompanySettingsMethods(
  _getDb: () => DatabaseSync,
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
  };
}
