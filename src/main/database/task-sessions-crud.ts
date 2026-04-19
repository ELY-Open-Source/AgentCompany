import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { TaskSessionRecord } from "@shared/types";
import { type ReadAll, type Transaction, nowIso } from "./helpers";

/**
 * Agent-scoped session lifecycle. Sessions belong to agents, not
 * tasks — `agents.session_id` is the canonical pointer, and
 * `task_sessions` rows are looked up by their own primary key only.
 * The pre-migration `tasks.active_session_id` / `task_sessions.task_id`
 * columns were dropped by v41; any read that still needs a session
 * given a task id resolves it through the task's assignee agent.
 */
export function buildTaskSessionMethods(
  getDb: () => DatabaseSync,
  _readAll: ReadAll,
  transaction: Transaction,
) {
  return {
    /**
     * Fetch a session by its primary key. This is the single lookup
     * path — the rotation evaluator, the worker's finalizer, and the
     * turn-context builder all know which session id they want because
     * they either receive it from the agent record or from the worker
     * event envelope.
     */
    getSessionById(sessionId: string): TaskSessionRecord | null {
      return (
        (getDb()
          .prepare(
            `SELECT id, company_id as companyId, agent_id as agentId,
       adapter_type as adapterType, last_run_id as lastRunId,
       last_error as lastError, run_count as runCount,
       total_input_tokens as totalInputTokens, total_output_tokens as totalOutputTokens,
       rotated_at as rotatedAt, rotation_reason as rotationReason,
       handoff_markdown as handoffMarkdown, created_at as createdAt, updated_at as updatedAt
       FROM task_sessions WHERE id = ?`,
          )
          .get(sessionId) as TaskSessionRecord | undefined) ?? null
      );
    },

    incrementSessionUsage(
      sessionId: string,
      inputTokens: number,
      outputTokens: number,
      runId: string,
    ): void {
      const ts = nowIso();
      getDb()
        .prepare(
          `UPDATE task_sessions
       SET run_count = run_count + 1,
           total_input_tokens = total_input_tokens + ?,
           total_output_tokens = total_output_tokens + ?,
           last_run_id = ?,
           updated_at = ?
       WHERE id = ?`,
        )
        .run(inputTokens, outputTokens, runId, ts, sessionId);
    },

    archiveSession(sessionId: string, reason: string, handoffMarkdown: string): void {
      const ts = nowIso();
      getDb()
        .prepare(
          `UPDATE task_sessions SET rotated_at = ?, rotation_reason = ?, handoff_markdown = ?, updated_at = ? WHERE id = ?`,
        )
        .run(ts, reason, handoffMarkdown, ts, sessionId);
    },

    /**
     * Return the agent's active session id, creating one lazily on
     * first call. One session per agent — switching tasks emits a
     * "now work on X" user turn on the ongoing transcript rather than
     * spawning a new session.
     */
    ensureAgentSession(input: {
      agentId: string;
      companyId: string;
      adapterType: string;
    }): string {
      const agentRow = getDb()
        .prepare("SELECT session_id FROM agents WHERE id = ?")
        .get(input.agentId) as { session_id: string | null } | undefined;
      if (agentRow?.session_id) return agentRow.session_id;

      const sessionId = randomUUID();
      const ts = nowIso();
      transaction(() => {
        getDb()
          .prepare(
            `INSERT INTO task_sessions (id, company_id, agent_id, adapter_type,
              run_count, total_input_tokens, total_output_tokens, created_at, updated_at)
             VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)`,
          )
          .run(sessionId, input.companyId, input.agentId, input.adapterType, ts, ts);
        getDb()
          .prepare("UPDATE agents SET session_id = ?, updated_at = ? WHERE id = ?")
          .run(sessionId, ts, input.agentId);
      });
      return sessionId;
    },

    setAgentSessionId(agentId: string, sessionId: string): void {
      const ts = nowIso();
      getDb()
        .prepare("UPDATE agents SET session_id = ?, updated_at = ? WHERE id = ?")
        .run(sessionId, ts, agentId);
    },

    /**
     * Create a replacement session row after rotation. Inherits the
     * agent / company / adapter type from the caller. Counters start
     * at zero — Pi Mono has no per-turn provider state to carry forward.
     */
    createNewSession(input: {
      companyId: string;
      agentId: string;
      adapterType: string;
    }): string {
      const sessionId = randomUUID();
      const ts = nowIso();
      getDb()
        .prepare(
          `INSERT INTO task_sessions (id, company_id, agent_id, adapter_type, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(sessionId, input.companyId, input.agentId, input.adapterType, ts, ts);
      return sessionId;
    },
  };
}
