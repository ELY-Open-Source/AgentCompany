import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { ReadAll, Transaction } from "./helpers";
import { nowIso } from "./helpers";

export function buildWakeupMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
) {
  function parseTriggerDetail(raw: string | null): Array<{ trigger?: string; at?: string; detail?: string }> {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry === "object") as Array<{ trigger?: string; at?: string; detail?: string }> : [];
    } catch {
      return [];
    }
  }

  function choosePreferredTrigger(triggers: string[]): string | null {
    const unique = new Set(triggers.filter(Boolean));
    const preferredOrder = [
      "message",
      "peer_request",
      "comment_mentioned",
      "approval_resolved",
      "subtask_completed",
      "report_blocked",
      "report_failed",
      "comment",
      "assignment",
      "manual",
      "timer",
    ];
    for (const trigger of preferredOrder) {
      if (unique.has(trigger)) return trigger;
    }
    return triggers[0] ?? null;
  }

  function mergeContextSnapshots(existingJson: string | null, incomingJson: string | null): string | null {
    if (!incomingJson) return existingJson;
    if (!existingJson) return incomingJson;
    const existing: Record<string, unknown> = JSON.parse(existingJson);
    const incoming: Record<string, unknown> = JSON.parse(incomingJson);
    return JSON.stringify({ ...existing, ...incoming });
  }

  return {
    enqueueWakeupRequest(companyId: string, agentId: string, trigger: string, detail: string, context?: Record<string, unknown>): void {
      const ts = nowIso();
      transaction(() => {
        const existing = getDb()
          .prepare(
            `SELECT id, trigger_detail, coalesced_count, context_snapshot
             FROM wakeup_requests
             WHERE agent_id = ? AND company_id = ? AND status IN ('queued', 'deferred')
             LIMIT 1`,
          )
          .get(agentId, companyId) as
            | { id: string; trigger_detail: string | null; coalesced_count: number; context_snapshot: string | null }
            | undefined;

        if (existing) {
          const triggers: Array<{ trigger: string; at: string; detail: string }> = existing.trigger_detail
            ? JSON.parse(existing.trigger_detail)
            : [];
          triggers.push({ trigger, at: ts, detail });
          let mergedContext: string | null = existing.context_snapshot;
          if (context) {
            const prev: Record<string, unknown> = existing.context_snapshot ? JSON.parse(existing.context_snapshot) : {};
            const merged = { ...prev, ...context };
            mergedContext = JSON.stringify(merged);
          }
          getDb()
            .prepare(
              `UPDATE wakeup_requests
                 SET trigger_detail = ?,
                     coalesced_count = coalesced_count + 1,
                     context_snapshot = ?,
                     updated_at = ?
               WHERE id = ?`,
            )
            .run(JSON.stringify(triggers), mergedContext, ts, existing.id);
        } else {
          const triggerDetail = JSON.stringify([{ trigger, at: ts, detail }]);
          const contextJson = context ? JSON.stringify(context) : null;
          getDb()
            .prepare(
              `INSERT INTO wakeup_requests
                 (id, company_id, agent_id, source, trigger_detail, status, coalesced_count, context_snapshot, requested_at, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?)`,
            )
            .run(randomUUID(), companyId, agentId, trigger, triggerDetail, contextJson, ts, ts, ts);
        }
      });
    },

    promoteWakeupRequests(agentId: string, companyId: string): number {
      let promoted = 0;
      transaction(() => {
        const queued = getDb()
          .prepare(
            `SELECT id, trigger_detail, context_snapshot FROM wakeup_requests
             WHERE agent_id = ? AND company_id = ? AND status = 'queued' LIMIT 1`,
          )
          .get(agentId, companyId) as { id: string; trigger_detail: string | null; context_snapshot: string | null } | undefined;
        const deferred = readAll<{ id: string; trigger_detail: string | null; coalesced_count: number; context_snapshot: string | null }>(
          `SELECT id, trigger_detail, coalesced_count, context_snapshot FROM wakeup_requests
           WHERE agent_id = ? AND company_id = ? AND status = 'deferred'`,
          agentId, companyId,
        );
        if (deferred.length === 0) return;
        const ts = nowIso();
        if (queued) {
          const queuedTriggers: Array<{ trigger: string; at: string; detail: string }> = queued.trigger_detail ? JSON.parse(queued.trigger_detail) : [];
          let addedCount = 0;
          let mergedCtx = queued.context_snapshot;
          for (const d of deferred) {
            const dTriggers: Array<{ trigger: string; at: string; detail: string }> = d.trigger_detail ? JSON.parse(d.trigger_detail) : [];
            queuedTriggers.push(...dTriggers);
            addedCount += d.coalesced_count + 1;
            mergedCtx = mergeContextSnapshots(mergedCtx, d.context_snapshot);
          }
          getDb().prepare(
            `UPDATE wakeup_requests SET trigger_detail = ?, coalesced_count = coalesced_count + ?, context_snapshot = ?, updated_at = ? WHERE id = ?`,
          ).run(JSON.stringify(queuedTriggers), addedCount, mergedCtx, ts, queued.id);
          for (const d of deferred) {
            getDb().prepare("DELETE FROM wakeup_requests WHERE id = ?").run(d.id);
          }
          promoted = deferred.length;
        } else {
          const [first, ...rest] = deferred;
          if (!first) return 0;
          getDb().prepare(
            `UPDATE wakeup_requests SET status = 'queued', updated_at = ? WHERE id = ?`,
          ).run(ts, first.id);
          if (rest.length > 0) {
            const firstTriggers: Array<{ trigger: string; at: string; detail: string }> = first.trigger_detail ? JSON.parse(first.trigger_detail) : [];
            let addedCount = 0;
            let mergedCtx = first.context_snapshot;
            for (const d of rest) {
              const dTriggers: Array<{ trigger: string; at: string; detail: string }> = d.trigger_detail ? JSON.parse(d.trigger_detail) : [];
              firstTriggers.push(...dTriggers);
              addedCount += d.coalesced_count + 1;
              mergedCtx = mergeContextSnapshots(mergedCtx, d.context_snapshot);
            }
            getDb().prepare(
              `UPDATE wakeup_requests SET trigger_detail = ?, coalesced_count = coalesced_count + ?, context_snapshot = ?, updated_at = ? WHERE id = ?`,
            ).run(JSON.stringify(firstTriggers), addedCount, mergedCtx, ts, first.id);
            for (const d of rest) {
              getDb().prepare("DELETE FROM wakeup_requests WHERE id = ?").run(d.id);
            }
          }
          promoted = deferred.length;
        }
      });
      return promoted;
    },

    listPendingWakeupAgents(companyId: string): Array<{ agentId: string }> {
      return readAll(
        `SELECT agent_id AS agentId
         FROM wakeup_requests
         WHERE company_id = ? AND status IN ('queued', 'deferred')
         GROUP BY agent_id
         ORDER BY MIN(requested_at) ASC`,
        companyId,
      );
    },

    listWakeupRequests(companyId: string, filters?: { status?: string; agentId?: string; limit?: number }): Array<{
      id: string; companyId: string; agentId: string; source: string; triggerDetail: string | null;
      status: string; coalescedCount: number; runId: string | null; requestedAt: string;
      claimedAt: string | null; finishedAt: string | null; createdAt: string; updatedAt: string;
    }> {
      const conditions = ["company_id = ?"];
      const params: SQLInputValue[] = [companyId];
      if (filters?.status) { conditions.push("status = ?"); params.push(filters.status); }
      if (filters?.agentId) { conditions.push("agent_id = ?"); params.push(filters.agentId); }
      const limit = filters?.limit ?? 50;
      return readAll(
        `SELECT id, company_id AS companyId, agent_id AS agentId, source, trigger_detail AS triggerDetail,
                status, coalesced_count AS coalescedCount, run_id AS runId, requested_at AS requestedAt,
                claimed_at AS claimedAt, finished_at AS finishedAt, created_at AS createdAt, updated_at AS updatedAt
         FROM wakeup_requests
         WHERE ${conditions.join(" AND ")}
         ORDER BY requested_at DESC
         LIMIT ?`,
        ...params, limit,
      );
    },

    getPreferredWakeTrigger(agentId: string, companyId: string): string | null {
      const rows = readAll<{ source: string; trigger_detail: string | null }>(
        `SELECT source, trigger_detail
         FROM wakeup_requests
         WHERE agent_id = ? AND company_id = ? AND status IN ('queued', 'deferred')
         ORDER BY requested_at ASC`,
        agentId,
        companyId,
      );
      if (rows.length === 0) return null;

      const triggers: string[] = [];
      for (const row of rows) {
        if (row.source) triggers.push(row.source);
        for (const entry of parseTriggerDetail(row.trigger_detail)) {
          if (typeof entry.trigger === "string" && entry.trigger.length > 0) {
            triggers.push(entry.trigger);
          }
        }
      }

      return choosePreferredTrigger(triggers);
    },

    completePendingWakeupRequests(agentId: string, companyId: string, runId: string): number {
      const ts = nowIso();
      const result = getDb().prepare(
        `UPDATE wakeup_requests
         SET status = 'completed',
             run_id = ?,
             claimed_at = COALESCE(claimed_at, ?),
             finished_at = ?,
             updated_at = ?
         WHERE agent_id = ? AND company_id = ? AND status IN ('queued', 'deferred')`,
      ).run(runId, ts, ts, ts, agentId, companyId);
      return Number(result.changes);
    },

    purgeExpiredWakeupRequests() {
      const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const result = getDb().prepare("DELETE FROM wakeup_requests WHERE created_at < ? AND status IN ('completed')").run(cutoff);
      return Number(result.changes);
    },
  };
}
