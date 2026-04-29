import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { ConnectorId, RunRecord, RunUsageStatus } from "@shared/types";
import { type ReadAll, type Transaction, nowIso, toBoolean } from "./helpers";
import { buildRunLogMethods } from "./run-logs";
import { buildRunEventMethods } from "./run-events";
import { buildCostEntryMethods } from "./cost-entries";
import { checkoutTaskInTransaction } from "./task-checkout";
import { deriveLegacyRunUsageStatus } from "../run-usage-status";

class TaskCheckoutConflict extends Error {
  constructor(readonly taskId: string) {
    super(`Task checkout conflict: ${taskId}`);
  }
}

export function buildRunMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
  deps: {
    logsDir: string;
  },
) {
  function createEmptyRunLog(logPath: string): void {
    writeFileSync(logPath, "", { encoding: "utf8", flag: "wx" });
  }

  function cleanupEmptyRunLog(logPath: string): void {
    rmSync(logPath, { force: true });
  }

  function insertRunRow(input: {
    id: string;
    companyId: string;
    taskId: string | null;
    agentId: string;
    workspaceId: string | null;
    connectorId: ConnectorId;
    logPath: string;
    ts: string;
  }): void {
    getDb()
      .prepare(
        "insert into runs (id, company_id, task_id, agent_id, workspace_id, connector_id, status, summary, unattributed_cost, log_path, created_at, updated_at) values (?, ?, ?, ?, ?, ?, 'queued', '', 0, ?, ?, ?)",
      )
      .run(
        input.id,
        input.companyId,
        input.taskId,
        input.agentId,
        input.workspaceId,
        input.connectorId,
        input.logPath,
        input.ts,
        input.ts,
      );
  }

  return {
    ...buildRunLogMethods(getDb, readAll, transaction),
    ...buildRunEventMethods(getDb, readAll, transaction),
    ...buildCostEntryMethods(getDb, readAll, transaction),

    getRun(id: string): RunRecord {
      const row = getDb()
        .prepare(
          "select id, company_id as companyId, task_id as taskId, agent_id as agentId, workspace_id as workspaceId, connector_id as connectorId, status, summary, error_message as errorMessage, exit_code as exitCode, signal, model, cost_usd as costUsd, unattributed_cost as unattributedCost, usage_status as usageStatus, started_at as startedAt, finished_at as finishedAt, log_path as logPath, created_at as createdAt, updated_at as updatedAt from runs where id = ?",
        )
        .get(id) as RunRecord | undefined;
      if (!row) throw new Error(`Run not found: ${id}`);
      row.unattributedCost = Boolean(row.unattributedCost);
      return row;
    },

    getRunAuthState(runId: string): { id: string; companyId: string; agentId: string; status: RunRecord["status"] } | null {
      const row = getDb()
        .prepare("select id, company_id as companyId, agent_id as agentId, status from runs where id = ?")
        .get(runId) as { id: string; companyId: string; agentId: string; status: RunRecord["status"] } | undefined;
      return row ?? null;
    },

    createRun(input: {
      id?: string;
      companyId: string;
      taskId: string | null;
      agentId: string;
      workspaceId: string | null;
      connectorId: ConnectorId;
    }) {
      const id = input.id ?? randomUUID();
      const ts = nowIso();
      const logPath = join(deps.logsDir, `${id}.log`);
      createEmptyRunLog(logPath);
      try {
        transaction(() => {
          insertRunRow({ ...input, id, logPath, ts });
        });
      } catch (error) {
        cleanupEmptyRunLog(logPath);
        throw error;
      }
      return { id, logPath };
    },

    createTaskRun(input: {
      id?: string;
      companyId: string;
      taskId: string;
      agentId: string;
      workspaceId: string | null;
      connectorId: ConnectorId;
    }): { id: string; logPath: string } | null {
      const id = input.id ?? randomUUID();
      const ts = nowIso();
      const logPath = join(deps.logsDir, `${id}.log`);
      createEmptyRunLog(logPath);
      try {
        transaction(() => {
          insertRunRow({ ...input, id, logPath, ts });
          const checkoutOk = checkoutTaskInTransaction(getDb(), input.taskId, id);
          if (!checkoutOk) {
            throw new TaskCheckoutConflict(input.taskId);
          }
        });
      } catch (error) {
        cleanupEmptyRunLog(logPath);
        if (error instanceof TaskCheckoutConflict) {
          return null;
        }
        throw error;
      }
      return { id, logPath };
    },

    markRunStatus(runId: string, status: RunRecord["status"], message: string | null) {
      const ts = nowIso();
      const startedAt = status === "running" ? ts : null;
      transaction(() => {
        getDb()
          .prepare(
            "update runs set status = ?, summary = case when ? is not null then ? else summary end, started_at = coalesce(started_at, ?), updated_at = ? where id = ?",
          )
          .run(status, message, message, startedAt, ts, runId);

        if (status === "running") {
          const run = getDb().prepare("select agent_id from runs where id = ?").get(runId) as { agent_id: string } | undefined;
          if (run) {
            getDb()
              .prepare("update agents set status = 'running', updated_at = ? where id = ? and status in ('idle', 'active')")
              .run(ts, run.agent_id);
          }
        }
      });
    },

    finishRun(input: {
      runId: string;
      status: RunRecord["status"];
      summary: string | null;
      errorMessage: string | null;
      exitCode: number | null;
      signal: string | null;
      model: string | null;
      unattributedCost: boolean;
      usageStatus?: RunUsageStatus;
      recoverTaskForRetry?: boolean;
    }) {
      const run = getDb().prepare("select task_id as taskId, agent_id as agentId, company_id as companyId, connector_id as connectorId, started_at as startedAt from runs where id = ?").get(input.runId) as
        | { taskId: string | null; agentId: string; companyId: string; connectorId: ConnectorId; startedAt: string | null }
        | undefined;
      if (!run) return { budgetHardStopped: false };
      // Recoverable terminal paths must roll the task back to 'todo'.
      // Otherwise the task is stuck in 'in_progress' with no owner:
      // checkoutTask refuses (WHERE status IN todo/backlog), and the
      // scheduler loops forever logging "lost checkout race".
      const runNeverStarted =
        run.startedAt === null && (input.status === "failed" || input.status === "cancelled");
      const shouldReturnTaskToTodo =
        run.taskId !== null && (runNeverStarted || input.recoverTaskForRetry === true);
      const ts = nowIso();
      const usageStatus = input.usageStatus ?? deriveLegacyRunUsageStatus({
        runStatus: input.status,
        unattributedCost: input.unattributedCost,
      });

      // Cost is owned by CostWriter — per-message rows in `cost_entries`.
      // finishRun reads the aggregate instead of writing another row, so
      // there is exactly one source of truth and `cost_entries.run_id`
      // cannot double-count against the previous finishRun INSERT.
      const costRow = getDb()
        .prepare("select coalesce(sum(amount_usd), 0) as total from cost_entries where run_id = ? and unattributed = 0")
        .get(input.runId) as { total: number } | undefined;
      const runCostUsd = costRow?.total ?? 0;

      const agent = getDb().prepare(
        "select budget_monthly_usd as budgetMonthlyUsd, spent_monthly_usd as spentMonthlyUsd, status from agents where id = ?",
      ).get(run.agentId) as { budgetMonthlyUsd: number; spentMonthlyUsd: number; status: string } | undefined;
      const nextSpend = (agent?.spentMonthlyUsd ?? 0) + runCostUsd;
      const budgetHardStopped = Boolean(
        agent &&
        agent.budgetMonthlyUsd > 0 &&
        nextSpend >= agent.budgetMonthlyUsd &&
        agent.status !== "paused" &&
        agent.status !== "terminated",
      );
      transaction(() => {
        getDb()
          .prepare(
            "update runs set status = ?, summary = ?, error_message = ?, exit_code = ?, signal = ?, model = ?, cost_usd = ?, unattributed_cost = ?, usage_status = ?, finished_at = ?, updated_at = ? where id = ?",
          )
          .run(
            input.status, input.summary ?? "", input.errorMessage, input.exitCode,
            input.signal, input.model, runCostUsd,
            input.unattributedCost ? 1 : 0, usageStatus, ts, ts, input.runId,
        );
        if (run.taskId !== null) {
          getDb()
            .prepare("delete from task_leases where task_id = ? and run_id = ?")
            .run(run.taskId, input.runId);
          if (shouldReturnTaskToTodo) {
            // Roll the task back to `todo` when no *other* live run claims
            // it. Invariant: `task.status = 'in_progress'` ⇒ a queued or
            // running run owns it through `task_leases`.
            getDb()
              .prepare(
                `UPDATE tasks
                 SET status = 'todo',
                     updated_at = ?
                 WHERE id = ?
                   AND status = 'in_progress'
                   AND NOT EXISTS (
                     SELECT 1 FROM task_leases l
                     WHERE l.task_id = tasks.id
                       AND l.run_id != ?
                   )`,
              )
              .run(ts, run.taskId, input.runId);
          }
        }
        if (runCostUsd > 0) {
          if (run.taskId !== null) {
            getDb()
              .prepare("update tasks set cost_usd = cost_usd + ?, updated_at = ? where id = ?")
              .run(runCostUsd, ts, run.taskId);
          }
          getDb()
            .prepare("update agents set spent_monthly_usd = spent_monthly_usd + ?, updated_at = ? where id = ?")
            .run(runCostUsd, ts, run.agentId);
        }
        if (budgetHardStopped) {
          getDb()
            .prepare("update agents set status = 'paused', updated_at = ? where id = ?")
            .run(ts, run.agentId);
        } else {
          getDb()
            .prepare("update agents set status = 'idle', updated_at = ? where id = ? and status = 'running'")
            .run(ts, run.agentId);
        }
      });
      return { budgetHardStopped };
    },

    markRunCompletionFailure(runId: string, errorMessage: string): void {
      const ts = nowIso();
      transaction(() => {
        getDb()
          .prepare(
            "update runs set status = 'failed', summary = ?, error_message = ?, usage_status = 'error_stop', finished_at = coalesce(finished_at, ?), updated_at = ? where id = ?",
          )
          .run("Run completion blocked by artifact projection failure.", errorMessage, ts, ts, runId);
      });
    },

    cancelRunForDeletion(runId: string, taskId: string | null, workspaceId: string | null, summary: string) {
      const ts = nowIso();
      getDb()
        .prepare(
          "update runs set status = 'cancelled', summary = ?, error_message = null, exit_code = null, signal = null, model = null, cost_usd = null, unattributed_cost = 1, usage_status = ?, finished_at = ?, updated_at = ? where id = ?",
        )
        .run(summary, "aborted_before_usage", ts, ts, runId);
      if (taskId !== null) {
        getDb()
          .prepare("delete from task_leases where task_id = ? and run_id = ?")
          .run(taskId, runId);
      }
      if (workspaceId) {
        getDb()
          .prepare(
            `update workspaces
               set lock_holder_run_id = null, lock_acquired_at = null, state = 'ready', updated_at = ?
             where id = ? and lock_holder_run_id = ?`,
          )
          .run(ts, workspaceId, runId);
      }
    },

    hasActiveRun(filter: { companyId: string; taskId?: string; agentId?: string }) {
      if (filter.taskId) {
        const whereClauses = [
          "l.company_id = ?",
          "l.task_id = ?",
          "r.status in ('queued', 'running')",
        ];
        const params: SQLInputValue[] = [filter.companyId, filter.taskId];
        if (filter.agentId) {
          whereClauses.push("r.agent_id = ?");
          params.push(filter.agentId);
        }
        const row = getDb().prepare(
          `select 1 as present
             from task_leases l
             join runs r on r.id = l.run_id
            where ${whereClauses.join(" and ")}
            limit 1`,
        ).get(...params) as { present: number } | undefined;
        return Boolean(row?.present);
      }

      const whereClauses = ["company_id = ?", "status in ('queued', 'running')"];
      const params: SQLInputValue[] = [filter.companyId];
      if (filter.agentId) {
        whereClauses.push("agent_id = ?");
        params.push(filter.agentId);
      }
      const row = getDb().prepare(
        `select 1 as present from runs where ${whereClauses.join(" and ")} limit 1`,
      ).get(...params) as { present: number } | undefined;
      return Boolean(row?.present);
    },

    listQueuedRuns() {
      return readAll<RunRecord>(
        `select id, company_id as companyId, task_id as taskId, agent_id as agentId, workspace_id as workspaceId,
                connector_id as connectorId, status, summary, error_message as errorMessage, exit_code as exitCode,
                signal, model, cost_usd as costUsd,
                unattributed_cost as unattributedCost, usage_status as usageStatus, started_at as startedAt, finished_at as finishedAt,
                log_path as logPath, created_at as createdAt, updated_at as updatedAt
           from runs
          where status = 'queued'
          order by created_at asc`,
      ).map((record) => ({ ...record, unattributedCost: toBoolean(record.unattributedCost) })) as RunRecord[];
    },

    getInterruptedRunsForRecovery(): Array<{
      runId: string; taskId: string; taskTitle: string; agentId: string;
      agentName: string; companyId: string; connectorId: string; interruptedAt: string;
    }> {
      return readAll<{
        runId: string; taskId: string; taskTitle: string; agentId: string;
        agentName: string; companyId: string; connectorId: string; interruptedAt: string;
      }>(
        `select r.id as runId, r.task_id as taskId, t.title as taskTitle,
                r.agent_id as agentId, a.name as agentName,
                r.company_id as companyId,
                r.connector_id as connectorId, r.finished_at as interruptedAt
         from runs r
         join tasks t on t.id = r.task_id
         join agents a on a.id = r.agent_id
         where r.status = 'interrupted'
         and t.status = 'blocked'
         order by r.finished_at desc`
      );
    },

    updateRunActor(runId: string, actorType: string, actorId: string | null): void {
      getDb().prepare(
        "UPDATE runs SET actor_type = ?, actor_id = ?, updated_at = ? WHERE id = ?"
      ).run(actorType, actorId, nowIso(), runId);
    },
  };
}
