import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import log from "electron-log/main.js";
import type { ApprovalRecord } from "@shared/types";
import type { ReadAll, Transaction } from "./helpers";
import { normalizeOptionalId, nowIso, parseJson } from "./helpers";

export function buildApprovalMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
  deps: {
    getAgent: (id: string) => { companyId: string; status: string };
  },
) {
  return {
    getApprovalRecord(id: string) {
      const row = getDb()
        .prepare(
          "select id, company_id as companyId, related_task_id as relatedTaskId, requested_by_agent_id as requestedByAgentId, related_agent_id as relatedAgentId, type, payload_summary as payloadSummary, impact_summary as impactSummary, payload_json as payloadJson, decision_note as decisionNote, state, created_at as createdAt, updated_at as updatedAt from approvals where id = ?",
        )
        .get(id) as (ApprovalRecord & { payloadJson: string | null; relatedAgentId: string | null }) | undefined;
      if (!row) throw new Error(`Approval not found: ${id}`);
      return row;
    },

    /**
     * Non-throwing lookup by id. Returns null when the approval does not
     * exist. Used by approval routes that need to branch on 404 rather
     * than catching an exception.
     */
    findApprovalById(id: string): (ApprovalRecord & { payloadJson: string | null; relatedAgentId: string | null }) | null {
      const row = getDb()
        .prepare(
          "select id, company_id as companyId, related_task_id as relatedTaskId, requested_by_agent_id as requestedByAgentId, related_agent_id as relatedAgentId, type, payload_summary as payloadSummary, impact_summary as impactSummary, payload_json as payloadJson, decision_note as decisionNote, state, created_at as createdAt, updated_at as updatedAt from approvals where id = ?",
        )
        .get(id) as (ApprovalRecord & { payloadJson: string | null; relatedAgentId: string | null }) | undefined;
      return row ?? null;
    },

    requestApproval(input: {
      companyId: string;
      relatedTaskId?: string | null;
      requestedByAgentId?: string | null;
      relatedAgentId?: string | null;
      type: string;
      payloadSummary: string;
      impactSummary: string;
      payloadJson?: string | null;
    }) {
      const id = randomUUID();
      const ts = nowIso();
      let relatedAgentId = normalizeOptionalId(input.relatedAgentId);
      if (!relatedAgentId && input.type === "hire_agent" && input.payloadJson) {
        try {
          const payload = JSON.parse(input.payloadJson) as { agentId?: string };
          relatedAgentId = payload.agentId ?? null;
        } catch (error) {
          log.warn(
            `[db/approvals] malformed payloadJson on hire_agent request for company ${input.companyId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (input.type === "hire_agent") {
        if (!relatedAgentId) {
          throw new Error("hire_agent approvals require a linked pending agent.");
        }
        const agent = deps.getAgent(relatedAgentId);
        if (agent.companyId !== input.companyId) {
          throw new Error(`Agent ${relatedAgentId} does not belong to company ${input.companyId}.`);
        }
        if (agent.status !== "pending_approval") {
          throw new Error(`hire_agent approvals can only target agents pending approval. Current status: ${agent.status}.`);
        }
      }
      getDb()
        .prepare(
          "insert into approvals (id, company_id, related_task_id, requested_by_agent_id, related_agent_id, type, payload_summary, impact_summary, payload_json, decision_note, state, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'pending', ?, ?)",
        )
        .run(
          id, input.companyId, normalizeOptionalId(input.relatedTaskId),
          normalizeOptionalId(input.requestedByAgentId), relatedAgentId,
          input.type, input.payloadSummary, input.impactSummary,
          input.payloadJson ?? null, ts, ts,
        );
      return id;
    },

    decideApproval(input: { companyId?: string | null; approvalId: string; state: string; decisionNote: string }) {
      const approval = getDb()
        .prepare(
          "select id, company_id as companyId, related_task_id as relatedTaskId, requested_by_agent_id as requestedByAgentId, related_agent_id as relatedAgentId, type, payload_summary as payloadSummary, impact_summary as impactSummary, payload_json as payloadJson, decision_note as decisionNote, state, created_at as createdAt, updated_at as updatedAt from approvals where id = ?",
        )
        .get(input.approvalId) as (ApprovalRecord & { payloadJson: string | null; relatedAgentId: string | null }) | undefined;
      if (!approval) throw new Error(`Approval not found: ${input.approvalId}`);
      if (input.companyId && approval.companyId !== input.companyId) {
        throw new Error(`Approval ${input.approvalId} does not belong to company ${input.companyId}.`);
      }
      if (!["pending", "revision_requested"].includes(approval.state)) {
        throw new Error(`Approval ${input.approvalId} is already ${approval.state} and cannot be re-decided.`);
      }
      const ts = nowIso();
      transaction(() => {
        getDb()
          .prepare("update approvals set state = ?, decision_note = ?, updated_at = ? where id = ?")
          .run(input.state, input.decisionNote, ts, input.approvalId);
        if (approval.type === "hire_agent") {
          const agentId = approval.relatedAgentId
            ?? parseJson<{ agentId?: string } | null>(approval.payloadJson, null)?.agentId
            ?? null;
          if (!agentId) {
            throw new Error(`hire_agent approval ${input.approvalId} has no linked agent — cannot resolve hire target. Ensure relatedAgentId or payloadJson.agentId is set.`);
          }
          if (input.state === "approved") {
            const result = getDb()
              .prepare("update agents set status = 'idle', updated_at = ? where id = ? and company_id = ? and status = 'pending_approval'")
              .run(ts, agentId, approval.companyId);
            if (result.changes === 0) {
              throw new Error(`hire_agent approval ${input.approvalId} could not activate agent ${agentId}; the agent is missing or no longer pending approval.`);
            }
          }
          if (input.state === "rejected") {
            const result = getDb()
              .prepare("update agents set status = 'terminated', updated_at = ? where id = ? and company_id = ? and status = 'pending_approval'")
              .run(ts, agentId, approval.companyId);
            if (result.changes === 0) {
              throw new Error(`hire_agent approval ${input.approvalId} could not reject agent ${agentId}; the agent is missing or no longer pending approval.`);
            }
          }
        }
      });
    },

    deleteApproval(id: string, companyId: string) {
      getDb().prepare("delete from approvals where id = ? and company_id = ?").run(id, companyId);
    },

    /**
     * Returns the requesting agent's pending approvals for standup
     * aggregation (id, type, state, payloadSummary, decisionNote).
     */
    listAgentPendingApprovals(
      companyId: string,
      agentId: string,
    ): Array<{
      id: string;
      type: string;
      state: string;
      payloadSummary: string | null;
      decisionNote: string | null;
    }> {
      return readAll(
        "select id, type, state, payload_summary as payloadSummary, decision_note as decisionNote from approvals where company_id = ? and requested_by_agent_id = ? and state = 'pending' order by created_at desc",
        companyId,
        agentId,
      );
    },

    /**
     * Returns up to `limit` of the requesting agent's resolved approvals
     * for standup aggregation (state != 'pending').
     */
    listAgentResolvedApprovals(
      companyId: string,
      agentId: string,
      limit = 5,
    ): Array<{
      id: string;
      type: string;
      state: string;
      payloadSummary: string | null;
      decisionNote: string | null;
    }> {
      return readAll(
        "select id, type, state, payload_summary as payloadSummary, decision_note as decisionNote from approvals where company_id = ? and requested_by_agent_id = ? and state != 'pending' order by created_at desc limit ?",
        companyId,
        agentId,
        limit,
      );
    },

    /**
     * Returns pending `hire_agent` approval payloads for a company, used
     * during hire-request creation to detect duplicate names across
     * concurrent requests.
     */
    listPendingHireApprovalPayloads(
      companyId: string,
    ): Array<{ payloadJson: string | null }> {
      return readAll<{ payloadJson: string | null }>(
        "select payload_json as payloadJson from approvals where company_id = ? and type = 'hire_agent' and state = 'pending'",
        companyId,
      );
    },

    /**
     * Returns the full approval row projection used by
     * GET /api/companies/:id/approvals. Optional filters match the
     * historical inline SQL behaviour.
     */
    listApprovalsForApi(companyId: string, filters: {
      requestedByAgentId?: string;
      relatedTaskId?: string;
      statuses?: string[] | null;
    }): Array<{
      id: string;
      companyId: string;
      relatedTaskId: string | null;
      relatedAgentId: string | null;
      requestedByAgentId: string | null;
      type: string;
      payloadSummary: string | null;
      impactSummary: string | null;
      payloadJson: string | null;
      decisionNote: string | null;
      state: string;
      createdAt: string;
      updatedAt: string;
    }> {
      let sql = "select id, company_id as companyId, related_task_id as relatedTaskId, related_agent_id as relatedAgentId, requested_by_agent_id as requestedByAgentId, type, payload_summary as payloadSummary, impact_summary as impactSummary, payload_json as payloadJson, decision_note as decisionNote, state, created_at as createdAt, updated_at as updatedAt from approvals where company_id = ?";
      const args: SQLInputValue[] = [companyId];
      if (filters.requestedByAgentId) {
        sql += " and requested_by_agent_id = ?";
        args.push(filters.requestedByAgentId);
      }
      if (filters.relatedTaskId) {
        sql += " and related_task_id = ?";
        args.push(filters.relatedTaskId);
      }
      if (filters.statuses && filters.statuses.length > 0) {
        sql += ` and state in (${filters.statuses.map(() => "?").join(", ")})`;
        args.push(...filters.statuses);
      }
      sql += " order by created_at desc";
      return readAll(sql, ...args);
    },

    getBlockingApproval(companyId: string, agentId: string, taskId: string | null): ApprovalRecord | null {
      const taskCondition = taskId != null
        ? "(related_task_id = ? or requested_by_agent_id = ?)"
        : "requested_by_agent_id = ?";
      const taskParams: SQLInputValue[] = taskId != null ? [taskId, agentId] : [agentId];
      const rows = readAll<ApprovalRecord>(
        `select id, company_id as companyId, related_task_id as relatedTaskId,
                requested_by_agent_id as requestedByAgentId, related_agent_id as relatedAgentId,
                type, payload_summary as payloadSummary, impact_summary as impactSummary,
                payload_json as payloadJson, decision_note as decisionNote, state,
                created_at as createdAt, updated_at as updatedAt
         from approvals
         where company_id = ? and state = 'pending'
           and (
             (type = 'hire_agent' and related_agent_id = ?)
             or (type = 'dangerous_command' and ${taskCondition})
             or (type = 'secret_access' and ${taskCondition})
             or (type = 'approve_ceo_strategy' and ${taskCondition})
             or (type = 'deliverable_review' and (requested_by_agent_id = ? or (related_task_id is not null and ${taskCondition})))
           )
         order by created_at asc limit 1`,
        companyId, agentId,
        ...taskParams, ...taskParams, ...taskParams,
        agentId, ...taskParams,
      );
      return rows.length > 0 ? rows[0] : null;
    },

    resubmitApproval(approvalId: string, companyId: string): void {
      const ts = nowIso();
      getDb().prepare(
        "UPDATE approvals SET state = 'pending', decision_note = '', updated_at = ? WHERE id = ? AND company_id = ? AND state = 'revision_requested'",
      ).run(ts, approvalId, companyId);
    },

    addApprovalComment(input: {
      companyId: string; approvalId: string; authorAgentId?: string | null;
      authorUserId?: string | null; body: string;
    }): string {
      const id = randomUUID();
      const ts = nowIso();
      getDb().prepare(
        "INSERT INTO approval_comments (id, company_id, approval_id, author_agent_id, author_user_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(id, input.companyId, input.approvalId, input.authorAgentId ?? null, input.authorUserId ?? null, input.body, ts, ts);
      return id;
    },

    listApprovalComments(approvalId: string, companyId: string) {
      return readAll<{
        id: string; company_id: string; approval_id: string; author_agent_id: string | null;
        author_user_id: string | null; body: string; created_at: string; updated_at: string;
      }>(
        "SELECT id, company_id, approval_id, author_agent_id, author_user_id, body, created_at, updated_at FROM approval_comments WHERE approval_id = ? AND company_id = ? ORDER BY created_at ASC",
        approvalId, companyId,
      ).map((r) => ({
        id: r.id, companyId: r.company_id, approvalId: r.approval_id,
        authorAgentId: r.author_agent_id, authorUserId: r.author_user_id,
        body: r.body, createdAt: r.created_at, updatedAt: r.updated_at,
      }));
    },

    linkTaskToApproval(taskId: string, approvalId: string, companyId: string, linkedByAgentId?: string | null): void {
      getDb().prepare(
        "INSERT OR IGNORE INTO task_approval_links (task_id, approval_id, company_id, linked_by_agent_id, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(taskId, approvalId, companyId, linkedByAgentId ?? null, nowIso());
    },

    unlinkTaskFromApproval(taskId: string, approvalId: string): void {
      getDb().prepare(
        "DELETE FROM task_approval_links WHERE task_id = ? AND approval_id = ?",
      ).run(taskId, approvalId);
    },

    listApprovalsForTask(taskId: string): string[] {
      return readAll<{ approval_id: string }>(
        "SELECT approval_id FROM task_approval_links WHERE task_id = ?", taskId,
      ).map((r) => r.approval_id);
    },

    listTasksForApproval(approvalId: string): string[] {
      return readAll<{ task_id: string }>(
        "SELECT task_id FROM task_approval_links WHERE approval_id = ?", approvalId,
      ).map((r) => r.task_id);
    },

    linkManyTasksToApproval(approvalId: string, taskIds: string[], companyId: string, linkedByAgentId?: string | null): void {
      if (taskIds.length === 0) return;
      const ts = nowIso();
      transaction(() => {
        const stmt = getDb().prepare(
          "INSERT OR IGNORE INTO task_approval_links (task_id, approval_id, company_id, linked_by_agent_id, created_at) VALUES (?, ?, ?, ?, ?)",
        );
        for (const taskId of taskIds) {
          stmt.run(taskId, approvalId, companyId, linkedByAgentId ?? null, ts);
        }
      });
    },

    /**
     * Returns the first pending approval linked to a task (id + type),
     * or null when none exists. Used by task-quality-gates to decide
     * whether an in-review task still has a blocking approval.
     */
    findPendingApprovalForTask(companyId: string, taskId: string): { id: string; type: string } | null {
      const row = getDb()
        .prepare(
          `SELECT id, type FROM approvals
           WHERE company_id = ? AND related_task_id = ? AND state = 'pending'
           LIMIT 1`,
        )
        .get(companyId, taskId) as { id: string; type: string } | undefined;
      return row ?? null;
    },

    /**
     * Returns true when the given agent has a pending review-type approval
     * against one of their tasks. Used by checkpoint-engine to decide
     * whether heartbeat should pause in co-founder mode.
     */
    hasPendingReviewApprovalForAgent(companyId: string, agentId: string): boolean {
      const row = getDb()
        .prepare(
          `SELECT 1 as hit FROM approvals a
           JOIN tasks t ON a.related_task_id = t.id
           WHERE a.company_id = ? AND a.state = 'pending'
           AND t.assignee_agent_id = ?
           AND a.type IN ('plan_review','scope_review','draft_review','strategy_review','deliverable_review','exception_review')
           LIMIT 1`,
        )
        .get(companyId, agentId) as { hit: number } | undefined;
      return row !== undefined;
    },
  };
}
