import type { DatabaseSync } from "node:sqlite";
import type { SendMessageInput } from "../../shared/commands";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";

export class ChatService {
  private readonly audit: AuditService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
  }

  sendMessage(input: SendMessageInput): string {
    const body = input.bodyMd.trim();
    if (!body) throw new Error("Message body is required.");
    const id = createId("msg");
    const threadId = input.threadId ?? createId("thread");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into chat_messages(
        id, org_id, space_id, thread_id, sender_type, sender_id, body_md, created_at, edited_at, deleted_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.orgId,
      input.spaceId,
      threadId,
      input.senderType,
      input.senderId,
      body,
      now,
      null,
      null,
    );
    if (!input.threadId) {
      this.db.prepare(`
        insert into chat_threads(id, org_id, space_id, root_message_id, title, state, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(threadId, input.orgId, input.spaceId, id, createThreadTitle(body), "open", now, now);
    } else {
      this.db.prepare("update chat_threads set updated_at = ? where id = ? and org_id = ?").run(now, input.threadId, input.orgId);
    }
    this.recordMentions(id, body);
    this.recordSlashInvocation(id, body, now);
    this.recordAttachments(input.orgId, id, input.attachmentFileIds ?? []);
    if (input.senderId) {
      this.db.prepare(`
        insert into chat_presence(principal_type, principal_id, status, status_text, last_seen_at)
        values (?, ?, ?, ?, ?)
        on conflict(principal_type, principal_id)
        do update set status = excluded.status, status_text = excluded.status_text, last_seen_at = excluded.last_seen_at
      `).run(input.senderType, input.senderId, "active", "", now);
    }
    this.audit.record({
      orgId: input.orgId,
      entityType: "chat_message",
      entityId: id,
      actorType: input.senderType,
      actorId: input.senderId,
      action: "sent",
      payload: { spaceId: input.spaceId, threadId, attachmentCount: input.attachmentFileIds?.length ?? 0 },
    });
    return id;
  }

  private recordMentions(messageId: string, body: string): void {
    const seen = new Set<string>();
    for (const match of body.matchAll(/(^|\s)@([A-Za-z][A-Za-z0-9_-]{1,63})/g)) {
      const target = match[2];
      const offsetStart = match.index + match[1].length;
      const key = `${target}:${offsetStart}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.db.prepare(`
        insert into chat_mentions(message_id, target_type, target_id, offset_start, offset_end)
        values (?, ?, ?, ?, ?)
      `).run(messageId, "alias", target, offsetStart, offsetStart + target.length + 1);
    }
  }

  private recordSlashInvocation(messageId: string, body: string, now: string): void {
    const match = body.match(/^\/([a-z][a-z0-9_-]*)(?:\s+([\s\S]*))?$/i);
    if (!match) return;
    const command = match[1].toLowerCase();
    if (!ALLOWED_SLASH_COMMANDS.has(command)) throw new Error(`Slash command /${command} is unavailable.`);
    this.db.prepare(`
      insert into chat_slash_invocations(id, message_id, command, args_json, result_ref, created_at)
      values (?, ?, ?, ?, ?, ?)
    `).run(createId("slash"), messageId, command, JSON.stringify({ raw: match[2] ?? "" }), null, now);
  }

  private recordAttachments(orgId: string, messageId: string, fileIds: string[]): void {
    for (const fileId of fileIds) {
      const file = this.db.prepare("select sha256 from file_objects where id = ? and org_id = ?")
        .get(fileId, orgId) as { sha256: string } | undefined;
      if (!file) throw new Error("Attachment file was not found.");
      this.db.prepare(`
        insert into chat_attachments(message_id, file_id, transfer_type, checksum, preview_key)
        values (?, ?, ?, ?, ?)
      `).run(messageId, fileId, "handoff", file.sha256, null);
    }
  }
}

const ALLOWED_SLASH_COMMANDS = new Set([
  "agent",
  "handoff",
  "approve",
  "deny",
  "skill",
  "runbook",
  "file",
  "escalate",
]);

function createThreadTitle(body: string): string {
  const firstLine = body.split(/\r?\n/, 1)[0].trim();
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}
