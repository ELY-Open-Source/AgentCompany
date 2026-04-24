import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { CommentRecord } from "@shared/types";
import { normalizeMarkdownText } from "@shared/markdown-text";
import type { ReadAll } from "./helpers";
import { nowIso } from "./helpers";

export function buildActivityMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
) {
  return {
    addActivity(input: { companyId: string; actor: string; action: string; entityType: string; entityId: string; detail: string }) {
      getDb()
        .prepare("insert into activity (id, company_id, actor, action, entity_type, entity_id, detail, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(randomUUID(), input.companyId, input.actor, input.action, input.entityType, input.entityId, input.detail, nowIso());
    },

    addComment(input: { companyId: string; taskId: string; authorAgentId: string | null; authorName: string; body: string }): CommentRecord {
      const taskRow = getDb().prepare("select company_id from tasks where id = ?").get(input.taskId) as { company_id: string } | undefined;
      if (!taskRow) throw new Error("Task not found.");
      if (taskRow.company_id !== input.companyId) throw new Error("Task does not belong to this company.");
      const body = normalizeMarkdownText(input.body);
      const id = randomUUID();
      const ts = nowIso();
      getDb().prepare(
        "insert into task_comments (id, company_id, task_id, author_agent_id, author_name, body, created_at) values (?, ?, ?, ?, ?, ?, ?)",
      ).run(id, input.companyId, input.taskId, input.authorAgentId, input.authorName, body, ts);
      return { id, companyId: input.companyId, taskId: input.taskId, authorAgentId: input.authorAgentId, authorName: input.authorName, body, createdAt: ts };
    },

    listComments(taskId: string): CommentRecord[] {
      return readAll<CommentRecord>(
        "select id, company_id as companyId, task_id as taskId, author_agent_id as authorAgentId, author_name as authorName, body, created_at as createdAt from task_comments where task_id = ? order by created_at asc",
        taskId,
      );
    },

    /**
     * Returns the `limit` most recent task comments (author_name + body +
     * createdAt) for a given set of task ids since `sinceIso`. Used by
     * GET /api/agents/me/standup to build the "recent comments" feed.
     */
    listRecentTaskComments(
      taskIds: string[],
      sinceIso: string,
      limit: number,
    ): Array<{
      id: string;
      taskId: string;
      authorName: string;
      body: string;
      createdAt: string;
    }> {
      if (taskIds.length === 0) return [];
      const placeholders = taskIds.map(() => "?").join(",");
      return readAll(
        `select id, task_id as taskId, author_name as authorName, body, created_at as createdAt from task_comments where task_id in (${placeholders}) and created_at > ? order by created_at desc limit ?`,
        ...taskIds,
        sinceIso,
        limit,
      );
    },
  };
}
