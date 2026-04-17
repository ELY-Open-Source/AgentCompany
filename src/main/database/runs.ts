import { randomUUID } from "node:crypto";
import { writeFileSync, readFileSync, existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { ConnectorId, RunLogChunk, RunRecord } from "@shared/types";
import { type ReadAll, type SqliteRow, type Transaction, nowIso, toBoolean } from "./helpers";

/**
 * Find the last complete UTF-8 character boundary in a buffer.
 * Returns the number of bytes up to (and including) the last complete character.
 * This prevents corrupting multi-byte CJK characters when slicing at chunk edges.
 */
function findUtf8Boundary(buffer: Buffer, bytesRead: number): number {
  if (bytesRead === 0) return 0;
  let pos = bytesRead - 1;
  while (pos >= 0 && (buffer[pos] & 0xc0) === 0x80) {
    pos--;
  }
  if (pos < 0) return bytesRead;
  const lead = buffer[pos];
  let charLen: number;
  if ((lead & 0x80) === 0) charLen = 1;
  else if ((lead & 0xe0) === 0xc0) charLen = 2;
  else if ((lead & 0xf0) === 0xe0) charLen = 3;
  else if ((lead & 0xf8) === 0xf0) charLen = 4;
  else return bytesRead;
  if (pos + charLen <= bytesRead) return bytesRead;
  return pos;
}

export function buildRunMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
  deps: {
    logsDir: string;
  },
) {
  return {
    getRun(id: string): RunRecord {
      const row = getDb()
        .prepare(
          "select id, company_id as companyId, task_id as taskId, agent_id as agentId, workspace_id as workspaceId, connector_id as connectorId, status, summary, error_message as errorMessage, exit_code as exitCode, signal, model, session_display_id as sessionDisplayId, cost_usd as costUsd, unattributed_cost as unattributedCost, started_at as startedAt, finished_at as finishedAt, log_path as logPath, created_at as createdAt, updated_at as updatedAt from runs where id = ?",
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
      taskId: string;
      agentId: string;
      workspaceId: string | null;
      connectorId: ConnectorId;
    }) {
      const id = input.id ?? randomUUID();
      const ts = nowIso();
      const logPath = join(deps.logsDir, `${id}.log`);
      transaction(() => {
        getDb()
          .prepare(
            "insert into runs (id, company_id, task_id, agent_id, workspace_id, connector_id, status, summary, unattributed_cost, log_path, created_at, updated_at) values (?, ?, ?, ?, ?, ?, 'queued', '', 0, ?, ?, ?)",
          )
          .run(id, input.companyId, input.taskId, input.agentId, input.workspaceId, input.connectorId, logPath, ts, ts);
        getDb().prepare("update tasks set active_run_id = ?, updated_at = ? where id = ?").run(id, ts, input.taskId);
      });
      writeFileSync(logPath, "", "utf8");
      return { id, logPath };
    },

    appendRunLog(runId: string, stream: "stdout" | "stderr", chunk: string) {
      const run = getDb().prepare("select log_path as logPath from runs where id = ?").get(runId) as { logPath: string | null } | undefined;
      if (!run?.logPath) return;
      return appendFile(run.logPath, `[${new Date().toISOString()}][${stream}] ${chunk}`, "utf8");
    },

    readRunLog(runId: string) {
      const run = getDb().prepare("select log_path as logPath from runs where id = ?").get(runId) as { logPath: string | null } | undefined;
      if (!run?.logPath) return "";
      try {
        return readFileSync(run.logPath, "utf8");
      } catch {
        return "";
      }
    },

    readRunLogChunk(runId: string, offset = 0, limit = 65_536): RunLogChunk {
      const run = getDb().prepare("select log_path as logPath from runs where id = ?").get(runId) as { logPath: string | null } | undefined;
      if (!run?.logPath || !existsSync(run.logPath)) {
        return { content: "", offset: 0, nextOffset: 0, totalBytes: 0, eof: true };
      }

      const totalBytes = statSync(run.logPath).size;
      const safeOffset = Math.max(0, Math.min(offset, totalBytes));
      const safeLimit = Math.max(1_024, Math.min(limit, 262_144));
      const bytesToRead = Math.max(0, Math.min(safeLimit, totalBytes - safeOffset));

      if (bytesToRead === 0) {
        return { content: "", offset: safeOffset, nextOffset: safeOffset, totalBytes, eof: true };
      }

      const fileDescriptor = openSync(run.logPath, "r");
      try {
        const buffer = Buffer.allocUnsafe(bytesToRead);
        const bytesRead = readSync(fileDescriptor, buffer, 0, bytesToRead, safeOffset);
        const safeBytesRead = findUtf8Boundary(buffer, bytesRead);
        const nextOffset = safeOffset + safeBytesRead;
        return {
          content: buffer.subarray(0, safeBytesRead).toString("utf8"),
          offset: safeOffset,
          nextOffset,
          totalBytes,
          eof: nextOffset >= totalBytes,
        };
      } finally {
        closeSync(fileDescriptor);
      }
    },

    markRunStatus(runId: string, status: RunRecord["status"], message: string) {
      const ts = nowIso();
      const startedAt = status === "running" ? ts : null;
      transaction(() => {
        getDb()
          .prepare(
            "update runs set status = ?, summary = case when ? != '' then ? else summary end, started_at = coalesce(started_at, ?), updated_at = ? where id = ?",
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
      sessionDisplayId: string | null;
      costUsd: number | null;
      unattributedCost: boolean;
    }) {
      const run = getDb().prepare("select task_id as taskId, agent_id as agentId, company_id as companyId, connector_id as connectorId from runs where id = ?").get(input.runId) as
        | { taskId: string; agentId: string; companyId: string; connectorId: ConnectorId }
        | undefined;
      if (!run) return { budgetHardStopped: false };
      const ts = nowIso();
      const agent = getDb().prepare(
        "select budget_monthly_usd as budgetMonthlyUsd, spent_monthly_usd as spentMonthlyUsd, status from agents where id = ?",
      ).get(run.agentId) as { budgetMonthlyUsd: number; spentMonthlyUsd: number; status: string } | undefined;
      const nextSpend =
        agent && typeof input.costUsd === "number" && Number.isFinite(input.costUsd)
          ? agent.spentMonthlyUsd + input.costUsd
          : agent?.spentMonthlyUsd ?? 0;
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
            "update runs set status = ?, summary = ?, error_message = ?, exit_code = ?, signal = ?, model = ?, session_display_id = ?, cost_usd = ?, unattributed_cost = ?, finished_at = ?, updated_at = ? where id = ?",
          )
          .run(
            input.status, input.summary ?? "", input.errorMessage, input.exitCode,
            input.signal, input.model, input.sessionDisplayId, input.costUsd,
            input.unattributedCost ? 1 : 0, ts, ts, input.runId,
          );
        getDb().prepare("update tasks set active_run_id = null, updated_at = ? where id = ?").run(ts, run.taskId);
        getDb()
          .prepare("UPDATE tasks SET checkout_run_id = NULL, execution_locked_at = NULL, updated_at = ? WHERE id = ? AND checkout_run_id = ?")
          .run(ts, run.taskId, input.runId);
        if (typeof input.costUsd === "number" && Number.isFinite(input.costUsd)) {
          getDb()
            .prepare("update tasks set cost_usd = cost_usd + ?, updated_at = ? where id = ?")
            .run(input.costUsd, ts, run.taskId);
          getDb()
            .prepare("update agents set spent_monthly_usd = spent_monthly_usd + ?, updated_at = ? where id = ?")
            .run(input.costUsd, ts, run.agentId);
          getDb()
            .prepare(
              "update agents set status = case when budget_monthly_usd > 0 and (spent_monthly_usd + ?) >= budget_monthly_usd then 'paused' else status end, updated_at = ? where id = ?",
            )
            .run(input.costUsd, ts, run.agentId);
        }
        const taskProjectRow = getDb().prepare("SELECT project_id FROM tasks WHERE id = ?").get(run.taskId) as { project_id: string | null } | undefined;
        const projectId = taskProjectRow?.project_id ?? null;
        getDb()
          .prepare("insert into cost_entries (id, company_id, run_id, task_id, agent_id, connector_id, amount_usd, unattributed, project_id, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(randomUUID(), run.companyId, input.runId, run.taskId, run.agentId, run.connectorId, input.costUsd, input.unattributedCost ? 1 : 0, projectId, ts);
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

    cancelRunForDeletion(runId: string, taskId: string, workspaceId: string | null, summary: string) {
      const ts = nowIso();
      getDb()
        .prepare(
          "update runs set status = 'cancelled', summary = ?, error_message = null, exit_code = null, signal = null, model = null, session_display_id = null, cost_usd = null, unattributed_cost = 1, finished_at = ?, updated_at = ? where id = ?",
        )
        .run(summary, ts, ts, runId);
      getDb().prepare("update tasks set active_run_id = null, updated_at = ? where id = ?").run(ts, taskId);
      getDb()
        .prepare("UPDATE tasks SET checkout_run_id = NULL, execution_locked_at = NULL, updated_at = ? WHERE id = ? AND checkout_run_id = ?")
        .run(ts, taskId, runId);
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
      const whereClauses = ["company_id = ?", "status in ('queued', 'running')"];
      const params: SQLInputValue[] = [filter.companyId];
      if (filter.taskId) {
        whereClauses.push("task_id = ?");
        params.push(filter.taskId);
      }
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
                signal, model, session_display_id as sessionDisplayId, cost_usd as costUsd,
                unattributed_cost as unattributedCost, started_at as startedAt, finished_at as finishedAt,
                log_path as logPath, created_at as createdAt, updated_at as updatedAt
           from runs
          where status = 'queued'
          order by created_at asc`,
      ).map((record) => ({ ...record, unattributedCost: toBoolean(record.unattributedCost) })) as RunRecord[];
    },

    getInterruptedRunsForRecovery(): Array<{
      runId: string; taskId: string; taskTitle: string; agentId: string;
      agentName: string; connectorId: string; interruptedAt: string;
    }> {
      return readAll<{
        runId: string; taskId: string; taskTitle: string; agentId: string;
        agentName: string; connectorId: string; interruptedAt: string;
      }>(
        `select r.id as runId, r.task_id as taskId, t.title as taskTitle,
                r.agent_id as agentId, a.name as agentName,
                r.connector_id as connectorId, r.finished_at as interruptedAt
         from runs r
         join tasks t on t.id = r.task_id
         join agents a on a.id = r.agent_id
         where r.status = 'interrupted'
         and t.status = 'blocked'
         order by r.finished_at desc`
      );
    },

    appendRunEvent(input: {
      companyId: string; runId: string; agentId: string;
      eventType: string; stream?: string | null; level?: string | null;
      message?: string | null; payload?: Record<string, unknown> | null;
    }): void {
      const ts = nowIso();
      const lastSeq = getDb().prepare(
        "SELECT MAX(seq) as maxSeq FROM run_events WHERE run_id = ?"
      ).get(input.runId) as { maxSeq: number | null } | undefined;
      const seq = (lastSeq?.maxSeq ?? 0) + 1;
      getDb().prepare(
        "INSERT INTO run_events (company_id, run_id, agent_id, seq, event_type, stream, level, message, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        input.companyId, input.runId, input.agentId, seq,
        input.eventType, input.stream ?? null, input.level ?? null,
        input.message ?? null, input.payload ? JSON.stringify(input.payload) : null, ts
      );
    },

    listRunEvents(runId: string, companyId: string, opts?: { offset?: number; limit?: number }): Array<{
      id: number; runId: string; agentId: string; seq: number; eventType: string;
      stream: string | null; level: string | null; message: string | null;
      payload: Record<string, unknown> | null; createdAt: string;
    }> {
      const offset = opts?.offset ?? 0;
      const limit = opts?.limit ?? 500;
      return readAll<SqliteRow>(
        "SELECT id, run_id, agent_id, seq, event_type, stream, level, message, payload, created_at FROM run_events WHERE run_id = ? AND company_id = ? ORDER BY seq ASC LIMIT ? OFFSET ?",
        runId, companyId, limit, offset
      ).map((row: SqliteRow) => ({
        id: row.id,
        runId: row.run_id,
        agentId: row.agent_id,
        seq: row.seq,
        eventType: row.event_type,
        stream: row.stream,
        level: row.level,
        message: row.message,
        payload: row.payload ? JSON.parse(row.payload) : null,
        createdAt: row.created_at,
      }));
    },

    listRunEventsAfter(runId: string, companyId: string, afterSeq: number, limit: number): Array<{
      id: number; runId: string; agentId: string; seq: number; eventType: string;
      stream: string | null; level: string | null; message: string | null;
      payload: Record<string, unknown> | null; createdAt: string;
    }> {
      return readAll<SqliteRow>(
        "SELECT id, run_id, agent_id, seq, event_type, stream, level, message, payload, created_at FROM run_events WHERE run_id = ? AND company_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?",
        runId, companyId, afterSeq, limit
      ).map((row: SqliteRow) => ({
        id: row.id,
        runId: row.run_id,
        agentId: row.agent_id,
        seq: row.seq,
        eventType: row.event_type,
        stream: row.stream,
        level: row.level,
        message: row.message,
        payload: row.payload ? JSON.parse(row.payload) : null,
        createdAt: row.created_at,
      }));
    },

    updateRunActor(runId: string, actorType: string, actorId: string | null): void {
      getDb().prepare(
        "UPDATE runs SET actor_type = ?, actor_id = ?, updated_at = ? WHERE id = ?"
      ).run(actorType, actorId, nowIso(), runId);
    },
  };
}
