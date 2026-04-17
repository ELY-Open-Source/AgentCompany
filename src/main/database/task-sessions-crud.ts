import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { TaskSessionRecord } from "@shared/types";
import { type ReadAll, type Transaction, nowIso } from "./helpers";

/**
 * Task-session lifecycle helpers extracted from tasks-crud.ts.
 *
 * Covers the agent-scoped session lifecycle:
 *   - updateTaskSession / getTaskSession / getActiveTaskSession
 *   - incrementSessionUsage / archiveSession
 *   - ensureAgentSession / setAgentSessionId / updateTasksActiveSessionForAgent
 *   - createNewSession
 *
 * Every method is spread into the final `buildTaskMethods` result, so
 * call-sites on AppDatabase remain unchanged.
 */
export function buildTaskSessionMethods(
  getDb: () => DatabaseSync,
  _readAll: ReadAll,
  transaction: Transaction,
) {
  return {
    updateTaskSession(
      taskId: string,
      sessionJson: Record<string, unknown> | null,
      sessionDisplayId: string | null,
    ): void {
      const ts = nowIso();
      const sessionParamsJson = sessionJson ? JSON.stringify(sessionJson) : null;
      const taskRow = getDb()
        .prepare(
          "select company_id as companyId, assignee_agent_id as assigneeAgentId, active_session_id as activeSessionId from tasks where id = ?",
        )
        .get(taskId) as
        | { companyId: string; assigneeAgentId: string | null; activeSessionId: string | null }
        | undefined;
      if (!taskRow) throw new Error(`Task not found: ${taskId}`);
      if (taskRow.activeSessionId) {
        getDb()
          .prepare(
            "update task_sessions set session_params_json = ?, session_display_id = ?, updated_at = ? where id = ?",
          )
          .run(sessionParamsJson, sessionDisplayId, ts, taskRow.activeSessionId);
        return;
      }
      if (sessionParamsJson === null && sessionDisplayId === null) return;
      const agentId = taskRow.assigneeAgentId ?? "unassigned";
      const agent = taskRow.assigneeAgentId
        ? (getDb()
            .prepare("select connector_id as connectorId from agents where id = ?")
            .get(taskRow.assigneeAgentId) as { connectorId: string } | undefined)
        : undefined;
      const adapterType = agent?.connectorId ?? "unknown";
      const sessionId = randomUUID();
      getDb()
        .prepare(
          `insert into task_sessions (id, company_id, task_id, agent_id, adapter_type, session_params_json, session_display_id, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sessionId,
          taskRow.companyId,
          taskId,
          agentId,
          adapterType,
          sessionParamsJson,
          sessionDisplayId,
          ts,
          ts,
        );
      getDb()
        .prepare("update tasks set active_session_id = ?, updated_at = ? where id = ?")
        .run(sessionId, ts, taskId);
    },

    getTaskSession(taskId: string): {
      sessionParams: Record<string, unknown> | null;
      sessionDisplayId: string | null;
    } {
      const taskRow = getDb()
        .prepare("select active_session_id as activeSessionId from tasks where id = ?")
        .get(taskId) as { activeSessionId: string | null } | undefined;
      if (!taskRow?.activeSessionId) {
        return { sessionParams: null, sessionDisplayId: null };
      }
      const row = getDb()
        .prepare(
          "select session_params_json as sessionParamsJson, session_display_id as sessionDisplayId from task_sessions where id = ?",
        )
        .get(taskRow.activeSessionId) as
        | { sessionParamsJson: string | null; sessionDisplayId: string | null }
        | undefined;
      let sessionParams: Record<string, unknown> | null = null;
      if (row?.sessionParamsJson) {
        sessionParams = JSON.parse(row.sessionParamsJson) as Record<string, unknown>;
      }
      return {
        sessionParams,
        sessionDisplayId: row?.sessionDisplayId ?? null,
      };
    },

    getActiveTaskSession(taskId: string): TaskSessionRecord | null {
      const task = getDb()
        .prepare("SELECT active_session_id FROM tasks WHERE id = ?")
        .get(taskId) as { active_session_id: string | null } | undefined;
      if (!task?.active_session_id) return null;
      return (
        (getDb()
          .prepare(
            `SELECT id, company_id as companyId, task_id as taskId, agent_id as agentId,
       adapter_type as adapterType, session_params_json as sessionParamsJson,
       session_display_id as sessionDisplayId, last_run_id as lastRunId,
       last_error as lastError, run_count as runCount,
       total_input_tokens as totalInputTokens, total_output_tokens as totalOutputTokens,
       rotated_at as rotatedAt, rotation_reason as rotationReason,
       handoff_markdown as handoffMarkdown, created_at as createdAt, updated_at as updatedAt
       FROM task_sessions WHERE id = ?`,
          )
          .get(task.active_session_id) as TaskSessionRecord | undefined) ?? null
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
     * Returns the agent's active session id, creating one lazily on first
     * call. Session is scoped to the agent (not to any particular task);
     * switching tasks emits a user turn on the ongoing transcript rather
     * than spawning a new session.
     *
     * Existing agents with pre-migration per-task sessions start fresh
     * after this upgrade: their first run creates a new agent-scoped
     * session. The old task_sessions + session_entries rows remain in the
     * DB as historical records but are not loaded for new runs. This is a
     * one-time transcript reset, accepted over a risky merge on a live
     * production DB.
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
        // task_id is left as empty string — the session is agent-scoped;
        // the column persists for backwards-compatible schema but no
        // longer keys the session to a particular task.
        getDb()
          .prepare(
            `INSERT INTO task_sessions (id, company_id, task_id, agent_id, adapter_type,
              session_params_json, session_display_id, run_count, total_input_tokens,
              total_output_tokens, created_at, updated_at)
             VALUES (?, ?, '', ?, ?, NULL, NULL, 0, 0, 0, ?, ?)`,
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
     * Point every task currently assigned to an agent at the agent's new
     * active session. Called after session rotation so UI paths reading
     * per-task active_session_id still see the agent's current session.
     */
    updateTasksActiveSessionForAgent(agentId: string, sessionId: string): void {
      const ts = nowIso();
      getDb()
        .prepare(
          "UPDATE tasks SET active_session_id = ?, updated_at = ? WHERE assignee_agent_id = ?",
        )
        .run(sessionId, ts, agentId);
    },

    createNewSession(input: {
      taskId: string;
      companyId: string;
      agentId: string;
      adapterType: string;
      sessionParamsJson: string | null;
      sessionDisplayId: string | null;
    }): string {
      const sessionId = randomUUID();
      const ts = nowIso();
      getDb()
        .prepare(
          `INSERT INTO task_sessions (id, company_id, task_id, agent_id, adapter_type,
       session_params_json, session_display_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sessionId,
          input.companyId,
          input.taskId,
          input.agentId,
          input.adapterType,
          input.sessionParamsJson,
          input.sessionDisplayId,
          ts,
          ts,
        );
      getDb()
        .prepare("UPDATE tasks SET active_session_id = ?, updated_at = ? WHERE id = ?")
        .run(sessionId, ts, input.taskId);
      return sessionId;
    },
  };
}
