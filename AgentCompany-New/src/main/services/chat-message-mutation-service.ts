import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DeleteMessageInput, EditMessageInput, SendMessageInput } from "../../shared/commands";
import { buildChatMessageStructure } from "./chat-message-structure";
import { recordChatMentions, resolveChatMentions } from "./chat-mentions";
import { AuditService } from "./audit-service";

interface MessageMutationRow {
  id: string;
  org_id: string;
  space_id: string;
  sender_type: SendMessageInput["senderType"];
  sender_id: string | null;
  body_md: string;
  deleted_at: string | null;
}

interface PrincipalRef {
  type: "employee" | "agent";
  id: string;
}

export class ChatMessageMutationService {
  private readonly audit: AuditService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
  }

  editMessage(input: EditMessageInput): void {
    const body = input.bodyMd.trim();
    if (!body) throw new Error("Message body is required.");
    if (parseSlashInvocation(body)) throw new Error("Slash command messages are immutable.");
    const message = this.requireMutableMessage(input.orgId, input.messageId);
    if (parseSlashInvocation(message.body_md)) throw new Error("Slash command messages are immutable.");
    this.assertMessageMutationActor(input, message);
    const attachmentFileIds = this.messageAttachmentFileIds(message.id);
    const mentions = resolveChatMentions(this.db, input.orgId, message.space_id, body);
    const structuredBody = buildChatMessageStructure({ slash: null, mentions, attachmentFileIds });
    const now = new Date().toISOString();
    this.db.prepare(`
      update chat_messages
      set body_md = ?, body_structured_json = ?, edited_at = ?
      where id = ? and org_id = ? and deleted_at is null
    `).run(body, structuredBody, now, message.id, input.orgId);
    this.db.prepare("delete from chat_mentions where message_id = ?").run(message.id);
    recordChatMentions(this.db, message.id, mentions);
    this.audit.record({
      orgId: input.orgId,
      entityType: "chat_message",
      entityId: message.id,
      actorType: input.actorType,
      actorId: input.actorId,
      action: "edited",
      payload: { editedAt: now, previousBodySha256: sha256(message.body_md), bodySha256: sha256(body) },
    });
  }

  deleteMessage(input: DeleteMessageInput): void {
    const message = this.requireMutableMessage(input.orgId, input.messageId);
    this.assertMessageMutationActor(input, message);
    const now = new Date().toISOString();
    this.db.prepare("update chat_messages set deleted_at = ? where id = ? and org_id = ? and deleted_at is null")
      .run(now, message.id, input.orgId);
    this.audit.record({
      orgId: input.orgId,
      entityType: "chat_message",
      entityId: message.id,
      actorType: input.actorType,
      actorId: input.actorId,
      action: "deleted",
      payload: { deletedAt: now, bodySha256: sha256(message.body_md) },
    });
  }

  private requireMutableMessage(orgId: string, messageId: string): MessageMutationRow {
    const message = this.db.prepare(`
      select id, org_id, space_id, sender_type, sender_id, body_md, deleted_at
      from chat_messages
      where id = ? and org_id = ?
    `).get(messageId, orgId) as MessageMutationRow | undefined;
    if (!message || message.deleted_at) throw new Error("Mutable chat message was not found.");
    return message;
  }

  private assertMessageMutationActor(input: EditMessageInput | DeleteMessageInput, message: MessageMutationRow): void {
    const actor = this.requireSender(input.orgId, input.actorType, input.actorId);
    if (actor) this.requireMembership(message.space_id, actor);
    if (input.actorType === "system") {
      if (message.sender_type === "system") return;
      throw new Error("Message actor is not allowed to mutate this message.");
    }
    if (input.actorType === "board") return;
    if (message.sender_type === input.actorType && message.sender_id === input.actorId) return;
    throw new Error("Message actor is not allowed to mutate this message.");
  }

  private requireSender(orgId: string, senderType: SendMessageInput["senderType"], senderId: string | null): PrincipalRef | null {
    if (senderType === "system") return null;
    if (senderType === "employee") return this.requirePrincipal("employees", orgId, senderId, "Employee actor");
    if (senderType === "agent") return this.requirePrincipal("agents", orgId, senderId, "Agent actor");
    return this.requirePrincipal("employees", orgId, senderId, "Board actor");
  }

  private requirePrincipal(table: "employees" | "agents", orgId: string, id: string | null, label: string): PrincipalRef {
    if (!id) throw new Error(`${label} is required.`);
    const row = this.db.prepare(`select id from ${table} where id = ? and org_id = ?`).get(id, orgId) as { id: string } | undefined;
    if (!row) throw new Error(`${label} was not found.`);
    return { type: table === "employees" ? "employee" : "agent", id };
  }

  private requireMembership(spaceId: string, principal: PrincipalRef): void {
    const row = this.db.prepare("select space_id from chat_memberships where space_id = ? and principal_type = ? and principal_id = ?")
      .get(spaceId, principal.type, principal.id) as { space_id: string } | undefined;
    if (!row) throw new Error("Chat membership is required.");
  }

  private messageAttachmentFileIds(messageId: string): string[] {
    const rows = this.db.prepare("select file_id from chat_attachments where message_id = ? order by file_id asc")
      .all(messageId) as Array<{ file_id: string }>;
    return rows.map((row) => row.file_id);
  }
}

function parseSlashInvocation(body: string): { command: string; args: string } | null {
  const match = body.match(/^\/([a-z][a-z0-9_-]*)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  return { command: match[1].toLowerCase(), args: match[2] ?? "" };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
