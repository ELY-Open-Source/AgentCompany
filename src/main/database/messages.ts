import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import log from "electron-log/main.js";
import type { AgentMessageRecord, AgentRecord } from "@shared/types";
import {
  BOARD_READER_ID,
  type ReadAll,
  type Transaction,
  nowIso,
} from "./helpers";

export function buildMessageMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  deps: {
    getAgent: (id: string) => AgentRecord;
    addActivity: (input: { companyId: string; actor: string; action: string; entityType: string; entityId: string; detail: string }) => void;
    transaction: Transaction;
  },
) {
  /** Write the @mention fan-out rows for a freshly-persisted message.
   *  Idempotent: the primary key is (message_id, agent_id), so a retry
   *  driven by a steer/wake race never duplicates rows. Skipping the
   *  sender keeps self-mentions out of the join so an agent talking
   *  about itself ("cc @me …") cannot inflate its own inbox. */
  function insertMessageMentions(
    messageId: string,
    companyId: string,
    fromAgentId: string,
    mentionedAgentIds: Iterable<string>,
    createdAt: string,
  ): void {
    const stmt = getDb().prepare(
      "insert or ignore into agent_message_mentions (message_id, agent_id, company_id, created_at) values (?, ?, ?, ?)",
    );
    for (const agentId of mentionedAgentIds) {
      if (!agentId || agentId === fromAgentId || agentId === BOARD_READER_ID) continue;
      stmt.run(messageId, agentId, companyId, createdAt);
    }
  }
  return {
    sendAgentMessage(input: {
      companyId: string;
      fromAgentId: string;
      toAgentId?: string | null;
      channel?: string;
      channelTargetId?: string | null;
      subject: string;
      body: string;
      priority?: string;
      parentMessageId?: string | null;
      attachmentsJson?: string;
      senderKind?: "agent" | "human" | "system";
      /** Agent IDs parsed out of the body's @mentions. Persisted into
       *  `agent_message_mentions` alongside the row so the inbox queries
       *  can surface the message to mentioned agents without re-parsing
       *  every body at read time. Empty / absent = no mention fan-out. */
      mentionedAgentIds?: readonly string[];
    }): string {
      const channel = input.channel ?? "direct";
      if (channel === "direct" && !input.toAgentId) {
        throw new Error("Direct messages require a recipient.");
      }
      const senderKind = input.senderKind
        ?? (input.fromAgentId === BOARD_READER_ID ? "human" : "agent");
      const id = randomUUID();
      const createdAt = nowIso();
      // Single transaction: the row and its mention fan-out must land
      // atomically, otherwise a crash between the two writes leaves a
      // message visible to its recipient but silently invisible to the
      // mentioned agents — which is exactly the old bug we're fixing.
      deps.transaction(() => {
        getDb()
          .prepare(
            "insert into agent_messages (id, company_id, from_agent_id, to_agent_id, sender_kind, channel, channel_target_id, subject, body, priority, parent_message_id, attachments_json, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(
            id,
            input.companyId,
            input.fromAgentId,
            input.toAgentId ?? null,
            senderKind,
            channel,
            input.channelTargetId ?? null,
            input.subject,
            input.body,
            input.priority ?? "normal",
            input.parentMessageId ?? null,
            input.attachmentsJson ?? "[]",
            createdAt,
          );
        if (input.mentionedAgentIds && input.mentionedAgentIds.length > 0) {
          insertMessageMentions(id, input.companyId, input.fromAgentId, input.mentionedAgentIds, createdAt);
        }
      });
      deps.addActivity({
        companyId: input.companyId,
        actor: input.fromAgentId,
        action: "sent_message",
        entityType: "agent_message",
        entityId: id,
        detail: `Message: ${input.subject}`,
      });
      return id;
    },

    getAgentMessage(messageId: string, companyId: string): AgentMessageRecord | null {
      const row = getDb()
        .prepare(
          "select id, company_id as companyId, from_agent_id as fromAgentId, to_agent_id as toAgentId, sender_kind as senderKind, channel, channel_target_id as channelTargetId, subject, body, priority, read_at as readAt, parent_message_id as parentMessageId, attachments_json as attachmentsJson, created_at as createdAt from agent_messages where id = ? and company_id = ?",
        )
        .get(messageId, companyId) as AgentMessageRecord | undefined;
      return row ?? null;
    },

    listAgentMessages(
      companyId: string,
      opts?: {
        agentId?: string;
        messageId?: string;
        channel?: string;
        channelTargetId?: string | null;
        unreadOnly?: boolean;
        limit?: number;
      },
    ): AgentMessageRecord[] {
      const limit = opts?.limit ?? 200;
      const selectCols =
        "select id, company_id as companyId, from_agent_id as fromAgentId, to_agent_id as toAgentId, sender_kind as senderKind, channel, channel_target_id as channelTargetId, subject, body, priority, read_at as readAt, parent_message_id as parentMessageId, attachments_json as attachmentsJson, created_at as createdAt from agent_messages";
      let sql = `${selectCols} where company_id = ?`;
      const params: SQLInputValue[] = [companyId];
      if (opts?.messageId) {
        sql += " and id = ?";
        params.push(opts.messageId);
      }
      if (opts?.channel) {
        sql += " and channel = ?";
        params.push(opts.channel);
      }
      if (opts?.channelTargetId !== undefined && opts?.channelTargetId !== null) {
        sql += " and channel_target_id = ?";
        params.push(opts.channelTargetId);
      }

      if (!opts?.agentId) {
        sql += " order by created_at desc";
        if (limit > 0) {
          sql += " limit ?";
          params.push(limit);
        }
        const rows = readAll<AgentMessageRecord>(sql, ...params).reverse();
        const boardReadReceiptMap = new Map(
          readAll<{ messageId: string; readAt: string }>(
            `select reads.message_id as messageId, reads.read_at as readAt
             from agent_message_reads reads
             join agent_messages messages on messages.id = reads.message_id
            where reads.agent_id = ? and messages.company_id = ?`,
            BOARD_READER_ID,
            companyId,
          ).map((row) => [row.messageId, row.readAt]),
        );
        let result = rows.map((message) => ({
          ...message,
          readAt: boardReadReceiptMap.get(message.id) ?? null,
        }));
        if (opts?.unreadOnly) {
          result = result.filter((message) => !message.readAt);
        }
        return result;
      }

      let department: string | null = null;
      try {
        const agent = deps.getAgent(opts.agentId);
        if (agent.companyId === companyId) {
          department = agent.department;
        }
      } catch (err) {
        log.warn(`[database/messages] getAgent failed for ${opts.agentId}; department filter disabled:`, err instanceof Error ? err.message : String(err));
        department = null;
      }

      const relevantProjectIds = new Set<string>();
      for (const row of readAll<{ projectId: string | null }>(
        "select distinct project_id as projectId from tasks where company_id = ? and assignee_agent_id = ? and project_id is not null",
        companyId,
        opts.agentId,
      )) {
        if (row.projectId) relevantProjectIds.add(row.projectId);
      }
      for (const row of readAll<{ id: string }>(
        "select id from projects where company_id = ? and lead_agent_id = ?",
        companyId,
        opts.agentId,
      )) {
        relevantProjectIds.add(row.id);
      }

      const visibilityClauses: string[] = [
        "from_agent_id = ?",
        "(channel = 'direct' and to_agent_id = ?)",
        "channel in ('company','incident')",
        "id in (select message_id from agent_message_mentions where agent_id = ? and company_id = ?)",
      ];
      const visibilityParams: SQLInputValue[] = [opts.agentId, opts.agentId, opts.agentId, companyId];
      if (department) {
        visibilityClauses.push("(channel = 'department' and channel_target_id = ?)");
        visibilityParams.push(department);
      }
      if (relevantProjectIds.size > 0) {
        const placeholders = Array.from(relevantProjectIds).map(() => "?").join(",");
        visibilityClauses.push(`(channel = 'project' and channel_target_id in (${placeholders}))`);
        visibilityParams.push(...Array.from(relevantProjectIds));
      }
      sql += ` and (${visibilityClauses.join(" or ")})`;
      params.push(...visibilityParams);
      sql += " order by created_at desc";
      if (limit > 0) {
        sql += " limit ?";
        params.push(limit);
      }
      const rows = readAll<AgentMessageRecord>(sql, ...params).reverse();

      const readReceiptMap = new Map(
        readAll<{ messageId: string; readAt: string }>(
          `select reads.message_id as messageId, reads.read_at as readAt
             from agent_message_reads reads
             join agent_messages messages on messages.id = reads.message_id
            where reads.agent_id = ? and messages.company_id = ?`,
          opts.agentId,
          companyId,
        ).map((row) => [row.messageId, row.readAt]),
      );

      let messages = rows.map((message) => {
        if (message.fromAgentId === opts.agentId) {
          return { ...message, readAt: message.createdAt };
        }
        return {
          ...message,
          readAt: readReceiptMap.get(message.id) ?? null,
        };
      });
      if (opts?.unreadOnly) {
        messages = messages.filter((message) => !message.readAt);
      }
      return messages;
    },

    searchMessages(
      companyId: string,
      query: string,
      opts?: {
        channel?: string;
        channelTargetId?: string | null;
        limit?: number;
      },
    ): AgentMessageRecord[] {
      const escaped = query.replace(/[\\%_]/g, "\\$&");
      const pattern = `%${escaped}%`;
      let sql = `SELECT id, company_id AS companyId, from_agent_id AS fromAgentId,
      to_agent_id AS toAgentId, sender_kind AS senderKind, channel, channel_target_id AS channelTargetId,
      subject, body, priority, read_at AS readAt, parent_message_id AS parentMessageId,
      attachments_json AS attachmentsJson, created_at AS createdAt
      FROM agent_messages WHERE company_id = ? AND (subject LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')`;
      const params: SQLInputValue[] = [companyId, pattern, pattern];
      if (opts?.channel) {
        sql += " AND channel = ?";
        params.push(opts.channel);
      }
      if (opts?.channelTargetId !== undefined && opts?.channelTargetId !== null) {
        sql += " AND channel_target_id = ?";
        params.push(opts.channelTargetId);
      }
      sql += " ORDER BY created_at DESC LIMIT ?";
      params.push(opts?.limit ?? 50);
      return readAll<AgentMessageRecord>(sql, ...params);
    },

    markMessageReadForReader(
      messageId: string,
      companyId: string,
      readerAgentId?: string | null,
    ): void {
      const ts = nowIso();
      getDb()
        .prepare(
          `insert into agent_message_reads (message_id, agent_id, read_at)
       select id, ?, ?
         from agent_messages
        where id = ? and company_id = ?
       on conflict(message_id, agent_id) do update set read_at = excluded.read_at`,
        )
        .run(readerAgentId ?? BOARD_READER_ID, ts, messageId, companyId);
    },

    /**
     * List unread inbox messages for an agent, chronologically oldest-first,
     * for pi-native transcript injection. Uses the same channel-subscription
     * visibility rules as listAgentMessages (direct/company/incident always,
     * department when agent belongs, project when assigned/lead).
     *
     * "Unread" is defined uniformly across every channel: no row in
     * `agent_message_reads` for (message_id, agent_id). The legacy
     * `agent_messages.read_at` column is never written anywhere in the
     * codebase and must not be used as a read signal — it only appears in
     * SELECT lists for wire-shape compatibility and is overwritten from the
     * read-receipts table by every caller that surfaces `readAt` to agents
     * or the renderer.
     *
     * Messages where `from_agent_id = agentId` are excluded (agents don't
     * inject their own sent messages back into their transcript).
     */
    listAgentInboxUnread(companyId: string, agentId: string): AgentMessageRecord[] {
      let department: string | null = null;
      try {
        const agent = deps.getAgent(agentId);
        if (agent.companyId === companyId) {
          department = agent.department;
        }
      } catch (err) {
        log.warn(`[database/messages] getAgent failed for ${agentId} in listAgentInboxUnread; department filter disabled:`, err instanceof Error ? err.message : String(err));
        department = null;
      }

      const relevantProjectIds = new Set<string>();
      for (const row of readAll<{ projectId: string | null }>(
        "select distinct project_id as projectId from tasks where company_id = ? and assignee_agent_id = ? and project_id is not null",
        companyId,
        agentId,
      )) {
        if (row.projectId) relevantProjectIds.add(row.projectId);
      }
      for (const row of readAll<{ id: string }>(
        "select id from projects where company_id = ? and lead_agent_id = ?",
        companyId,
        agentId,
      )) {
        relevantProjectIds.add(row.id);
      }

      const visibilityClauses: string[] = [
        "(channel = 'direct' and to_agent_id = ?)",
        "channel in ('company','incident')",
        // @mention fan-out: a DM addressed to someone else still lands
        // in my inbox when I'm mentioned in the body, because the
        // dispatcher persisted (message_id, agent_id) into
        // `agent_message_mentions` at write time. Without this clause a
        // "@CEO please update" inside a human ↔ engineer chat woke CEO
        // with an empty inbox and produced silence instead of a reply.
        "id in (select message_id from agent_message_mentions where agent_id = ? and company_id = ?)",
      ];
      const visibilityParams: SQLInputValue[] = [agentId, agentId, companyId];
      if (department) {
        visibilityClauses.push("(channel = 'department' and channel_target_id = ?)");
        visibilityParams.push(department);
      }
      if (relevantProjectIds.size > 0) {
        const placeholders = Array.from(relevantProjectIds).map(() => "?").join(",");
        visibilityClauses.push(`(channel = 'project' and channel_target_id in (${placeholders}))`);
        visibilityParams.push(...Array.from(relevantProjectIds));
      }

      const selectCols =
        "select id, company_id as companyId, from_agent_id as fromAgentId, to_agent_id as toAgentId, sender_kind as senderKind, channel, channel_target_id as channelTargetId, subject, body, priority, read_at as readAt, parent_message_id as parentMessageId, attachments_json as attachmentsJson, created_at as createdAt from agent_messages";
      const sql = `${selectCols} where company_id = ? and from_agent_id != ? and (${visibilityClauses.join(" or ")}) order by created_at asc`;
      const rows = readAll<AgentMessageRecord>(sql, companyId, agentId, ...visibilityParams);

      const readIds = new Set(
        readAll<{ messageId: string }>(
          `select reads.message_id as messageId
             from agent_message_reads reads
             join agent_messages messages on messages.id = reads.message_id
            where reads.agent_id = ? and messages.company_id = ?`,
          agentId,
          companyId,
        ).map((row) => row.messageId),
      );

      return rows.filter((message) => !readIds.has(message.id));
    },

  };
}
