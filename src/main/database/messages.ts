import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
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
    }): string {
      const channel = input.channel ?? "direct";
      if (channel === "direct" && !input.toAgentId) {
        throw new Error("Direct messages require a recipient.");
      }
      const senderKind = input.senderKind
        ?? (input.fromAgentId === BOARD_READER_ID ? "human" : "agent");
      const id = randomUUID();
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
          nowIso(),
        );
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
      } catch {
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
      ];
      const visibilityParams: SQLInputValue[] = [opts.agentId, opts.agentId];
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
     * "Unread" means:
     *  - Direct messages to this agent: `agent_messages.read_at IS NULL`.
     *  - Channel messages: no matching row in `agent_message_reads` for
     *    (message_id, agent_id).
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
      } catch {
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
      ];
      const visibilityParams: SQLInputValue[] = [agentId];
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

      return rows.filter((message) => {
        if (message.channel === "direct" && message.toAgentId === agentId) {
          return !message.readAt;
        }
        return !readIds.has(message.id);
      });
    },

    /**
     * Transactionally mark a batch of messages as delivered to `agentId`.
     * - Direct messages: sets agent_messages.read_at = now() if currently null.
     * - All messages (direct + channel): insert into agent_message_reads with
     *   ON CONFLICT DO NOTHING so reprocessing is idempotent.
     */
    markAgentInboxDelivered(agentId: string, messageIds: string[]): void {
      if (messageIds.length === 0) return;
      const ts = nowIso();
      deps.transaction(() => {
        const db = getDb();
        const directUpdate = db.prepare(
          "update agent_messages set read_at = ? where id = ? and to_agent_id = ? and read_at is null",
        );
        const receiptInsert = db.prepare(
          "insert into agent_message_reads (message_id, agent_id, read_at) values (?, ?, ?) on conflict(message_id, agent_id) do nothing",
        );
        for (const id of messageIds) {
          directUpdate.run(ts, id, agentId);
          receiptInsert.run(id, agentId, ts);
        }
      });
    },
  };
}
