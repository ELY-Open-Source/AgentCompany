import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { BudgetIncidentRecord, BudgetPolicyRecord } from "@shared/types";
import type { ReadAll, SqliteRow, Transaction } from "./helpers";
import { nowIso } from "./helpers";

function mapPolicyRow(r: SqliteRow): BudgetPolicyRecord {
  return {
    id: r.id,
    companyId: r.company_id,
    scopeType: r.scope_type,
    scopeId: r.scope_id,
    metric: r.metric,
    windowKind: r.window_kind,
    amount: r.amount,
    warnPercent: r.warn_percent,
    hardStopEnabled: !!r.hard_stop_enabled,
    notifyEnabled: !!r.notify_enabled,
    isActive: !!r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function buildBudgetMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
) {
  function getCalendarMonthWindow(): { start: string; end: string } {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const start = new Date(Date.UTC(year, month, 1)).toISOString();
    const end = new Date(Date.UTC(year, month + 1, 1)).toISOString();
    return { start, end };
  }

  return {
    saveBudgetPolicy(input: {
      id?: string | null;
      companyId: string;
      scopeType: string;
      scopeId: string;
      metric?: string;
      windowKind?: string;
      amount: number;
      warnPercent?: number;
      hardStopEnabled?: boolean;
      notifyEnabled?: boolean;
      isActive?: boolean;
    }): string {
      const ts = nowIso();
      const metric = input.metric ?? "billed_cents";
      const windowKind = input.windowKind ?? "calendar_month_utc";
      const scopedExisting = input.id
        ? []
        : readAll<{ id: string; createdAt: string }>(
            `SELECT id, created_at as createdAt
               FROM budget_policies
              WHERE company_id = ? AND scope_type = ? AND scope_id = ? AND metric = ? AND window_kind = ?
              ORDER BY created_at ASC`,
            input.companyId,
            input.scopeType,
            input.scopeId,
            metric,
            windowKind,
          );
      const existing = input.id
        ? getDb()
            .prepare("SELECT id, created_at as createdAt FROM budget_policies WHERE id = ?")
            .get(input.id) as { id: string; createdAt: string } | undefined
        : scopedExisting[0];
      const staleIds = input.id ? [] : scopedExisting.slice(1).map((policy) => policy.id);
      const id = existing?.id ?? input.id ?? randomUUID();
      const createdAt = existing?.createdAt ?? ts;
      getDb()
        .prepare(
          `INSERT OR REPLACE INTO budget_policies
           (id, company_id, scope_type, scope_id, metric, window_kind, amount, warn_percent,
            hard_stop_enabled, notify_enabled, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id, input.companyId, input.scopeType, input.scopeId,
          metric, windowKind,
          input.amount, input.warnPercent ?? 80,
          (input.hardStopEnabled ?? true) ? 1 : 0,
          (input.notifyEnabled ?? true) ? 1 : 0,
          (input.isActive ?? true) ? 1 : 0, createdAt, ts,
        );
      if (staleIds.length > 0) {
        const placeholders = staleIds.map(() => "?").join(", ");
        getDb()
          .prepare(`UPDATE budget_policies SET is_active = 0, updated_at = ? WHERE id IN (${placeholders})`)
          .run(ts, ...staleIds);
      }
      return id;
    },

    deleteBudgetPolicy(companyId: string, policyId: string): void {
      transaction(() => {
        getDb().prepare("DELETE FROM budget_incidents WHERE policy_id = ?").run(policyId);
        getDb().prepare("DELETE FROM budget_policies WHERE id = ? AND company_id = ?").run(policyId, companyId);
      });
    },

    listBudgetPolicies(companyId: string): BudgetPolicyRecord[] {
      return readAll<SqliteRow>(
        "SELECT * FROM budget_policies WHERE company_id = ? ORDER BY scope_type, created_at",
        companyId,
      ).map(mapPolicyRow);
    },

    getBudgetPolicy(policyId: string): BudgetPolicyRecord | null {
      const r = getDb().prepare("SELECT * FROM budget_policies WHERE id = ?").get(policyId) as SqliteRow | undefined;
      if (!r) return null;
      return mapPolicyRow(r);
    },

    getActivePoliciesForRun(companyId: string, agentId: string, projectId: string | null): BudgetPolicyRecord[] {
      const sql = projectId
        ? `SELECT * FROM budget_policies
           WHERE company_id = ? AND is_active = 1
           AND (
             (scope_type = 'company' AND scope_id = ?)
             OR (scope_type = 'agent' AND scope_id = ?)
             OR (scope_type = 'project' AND scope_id = ?)
           )`
        : `SELECT * FROM budget_policies
           WHERE company_id = ? AND is_active = 1
           AND (
             (scope_type = 'company' AND scope_id = ?)
             OR (scope_type = 'agent' AND scope_id = ?)
           )`;
      const params: SQLInputValue[] = projectId
        ? [companyId, companyId, agentId, projectId]
        : [companyId, companyId, agentId];
      return readAll<SqliteRow>(sql, ...params).map(mapPolicyRow);
    },

    getCalendarMonthWindow,

    getSpentInWindow(policy: BudgetPolicyRecord): number {
      const { start, end } = getCalendarMonthWindow();
      let sql: string;
      let params: SQLInputValue[];
      if (policy.scopeType === "agent") {
        sql = "SELECT COALESCE(SUM(amount_usd), 0) * 100 as total_cents FROM cost_entries WHERE company_id = ? AND created_at >= ? AND created_at < ? AND agent_id = ?";
        params = [policy.companyId, start, end, policy.scopeId];
      } else if (policy.scopeType === "project") {
        sql = "SELECT COALESCE(SUM(amount_usd), 0) * 100 as total_cents FROM cost_entries WHERE company_id = ? AND created_at >= ? AND created_at < ? AND project_id = ?";
        params = [policy.companyId, start, end, policy.scopeId];
      } else {
        sql = "SELECT COALESCE(SUM(amount_usd), 0) * 100 as total_cents FROM cost_entries WHERE company_id = ? AND created_at >= ? AND created_at < ?";
        params = [policy.companyId, start, end];
      }
      const row = getDb().prepare(sql).get(...params) as { total_cents: number } | undefined;
      return Math.round(row?.total_cents ?? 0);
    },

    upsertBudgetIncident(
      policy: BudgetPolicyRecord,
      thresholdType: "warn_threshold" | "hard_stop",
      amountObserved: number,
    ): string {
      const { start, end } = getCalendarMonthWindow();
      const existing = getDb()
        .prepare(
          "SELECT id FROM budget_incidents WHERE policy_id = ? AND window_start = ? AND threshold_type = ? AND status = 'open'",
        )
        .get(policy.id, start, thresholdType) as { id: string } | undefined;

      const ts = nowIso();
      if (existing) {
        getDb()
          .prepare("UPDATE budget_incidents SET amount_observed = ?, updated_at = ? WHERE id = ?")
          .run(amountObserved, ts, existing.id);
        return existing.id;
      }

      const id = randomUUID();
      getDb()
        .prepare(
          `INSERT INTO budget_incidents
           (id, company_id, policy_id, scope_type, scope_id, metric, window_kind,
            window_start, window_end, threshold_type, amount_limit, amount_observed,
            status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
        )
        .run(
          id, policy.companyId, policy.id, policy.scopeType, policy.scopeId,
          policy.metric, policy.windowKind, start, end, thresholdType,
          policy.amount, amountObserved, ts, ts,
        );
      return id;
    },

    listBudgetIncidents(companyId: string, statusFilter: string = "all"): BudgetIncidentRecord[] {
      const sql = statusFilter === "all"
        ? "SELECT * FROM budget_incidents WHERE company_id = ? ORDER BY created_at DESC"
        : "SELECT * FROM budget_incidents WHERE company_id = ? AND status = ? ORDER BY created_at DESC";
      const rows = statusFilter === "all"
        ? readAll<SqliteRow>(sql, companyId)
        : readAll<SqliteRow>(sql, companyId, statusFilter);
      return rows.map((r) => ({
        id: r.id, companyId: r.company_id, policyId: r.policy_id,
        scopeType: r.scope_type, scopeId: r.scope_id, metric: r.metric,
        windowKind: r.window_kind, windowStart: r.window_start, windowEnd: r.window_end,
        thresholdType: r.threshold_type, amountLimit: r.amount_limit,
        amountObserved: r.amount_observed, status: r.status,
        resolvedAt: r.resolved_at, createdAt: r.created_at, updatedAt: r.updated_at,
      }));
    },

    resolveBudgetIncident(incidentId: string, companyId: string): void {
      const ts = nowIso();
      getDb()
        .prepare(
          "UPDATE budget_incidents SET status = 'resolved', resolved_at = ?, updated_at = ? WHERE id = ? AND company_id = ? AND status = 'open'",
        )
        .run(ts, ts, incidentId, companyId);
    },

    resolveIncidentsForPolicy(policyId: string, resolutionStatus: string): number {
      const ts = nowIso();
      const result = getDb()
        .prepare(
          "UPDATE budget_incidents SET status = ?, resolved_at = ?, updated_at = ? WHERE policy_id = ? AND status = 'open'",
        )
        .run(resolutionStatus, ts, ts, policyId);
      return Number(result.changes);
    },

    resolveWarnIncidentsForPolicy(policyId: string, resolutionStatus: string): number {
      const ts = nowIso();
      const result = getDb()
        .prepare(
          "UPDATE budget_incidents SET status = ?, resolved_at = ?, updated_at = ? WHERE policy_id = ? AND status = 'open' AND threshold_type = 'warn_threshold'",
        )
        .run(resolutionStatus, ts, ts, policyId);
      return Number(result.changes);
    },

    autoCloseExpiredIncidents(companyId: string): number {
      const ts = nowIso();
      const result = getDb()
        .prepare(
          "UPDATE budget_incidents SET status = 'auto_closed', resolved_at = ?, updated_at = ? WHERE company_id = ? AND status = 'open' AND window_end <= ?",
        )
        .run(ts, ts, companyId, ts);
      return Number(result.changes);
    },
  };
}
