import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { type ReadAll, type Transaction, nowIso } from "./helpers";

/**
 * cost_entries writer extracted from runs.ts. Spread into the final
 * `buildRunMethods` result so AppDatabase call-sites remain unchanged.
 *
 * Note: finishRun still reads SUM(cost_entries.amount_usd) inline. The
 * SUM query stays in runs.ts to keep the run-aggregate read path local to
 * the rest of finishRun.
 */
export function buildCostEntryMethods(
  getDb: () => DatabaseSync,
  _readAll: ReadAll,
  _transaction: Transaction,
) {
  return {
    /**
     * Single writer for `cost_entries`. CostWriter calls this per
     * `message_end`; tests also call it to simulate per-turn cost.
     * finishRun reads SUM(cost_entries) for the run-level aggregate,
     * so this is the authoritative path for cost attribution.
     */
    recordCostEntry(input: {
      runId: string;
      companyId: string;
      agentId: string;
      taskId: string | null;
      connectorId: string;
      amountUsd: number | null;
      unattributed: boolean;
    }): string {
      const id = randomUUID();
      const ts = nowIso();
      const projectRow = input.taskId
        ? getDb().prepare("SELECT project_id FROM tasks WHERE id = ?").get(input.taskId) as { project_id: string | null } | undefined
        : undefined;
      const projectId = projectRow?.project_id ?? null;
      getDb()
        .prepare(
          "insert into cost_entries (id, company_id, run_id, task_id, agent_id, connector_id, amount_usd, unattributed, project_id, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id, input.companyId, input.runId, input.taskId, input.agentId,
          input.connectorId, input.amountUsd,
          input.unattributed ? 1 : 0, projectId, ts,
        );
      return id;
    },
  };
}
