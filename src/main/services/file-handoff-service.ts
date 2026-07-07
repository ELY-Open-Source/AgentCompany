import type { DatabaseSync } from "node:sqlite";
import type { SendMessageInput } from "../../shared/commands";
import type { FileScanState } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";
import type { MentionTarget, ResolvedMention } from "./chat-mentions";

export interface FileHandoffAttachment {
  fileId: string;
  checksum: string;
  scanState: FileScanState;
  scanLabelsJson: string;
  objectRef: string;
}

interface RecordFileHandoffsInput {
  orgId: string;
  spaceId: string;
  messageId: string;
  threadId: string;
  senderType: SendMessageInput["senderType"];
  senderId: string | null;
  attachments: FileHandoffAttachment[];
  mentions: ResolvedMention[];
  now: string;
}

export class FileHandoffService {
  private readonly audit: AuditService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
  }

  record(input: RecordFileHandoffsInput): void {
    if (input.attachments.length === 0) return;
    const recipients = this.attachmentGrantRecipients(input.orgId, input.spaceId, input.mentions);
    const attachmentStatement = this.db.prepare(`
      insert into chat_attachments(message_id, file_id, transfer_type, checksum, preview_key)
      values (?, ?, ?, ?, ?)
    `);
    const grantStatement = this.db.prepare(`
      insert or ignore into file_access_grants(
        id, org_id, file_id, granted_to_type, granted_to_id, granted_by_type, granted_by_id,
        source_message_id, source_thread_id, access_level, created_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const handoffStatement = this.db.prepare(`
      insert or ignore into file_handoff_records(
        id, org_id, message_id, file_id, source_principal_type, source_principal_id,
        target_principal_type, target_principal_id, transfer_type, checksum, scan_state,
        scan_labels_json, policy_decision, object_ref, created_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const attachment of input.attachments) {
      attachmentStatement.run(input.messageId, attachment.fileId, "handoff", attachment.checksum, null);
      for (const recipient of recipients) {
        const grant = grantStatement.run(
          createId("fgr"),
          input.orgId,
          attachment.fileId,
          recipient.type,
          recipient.id,
          input.senderType,
          input.senderId,
          input.messageId,
          input.threadId,
          "read",
          input.now,
        );
        handoffStatement.run(
          createId("fhr"),
          input.orgId,
          input.messageId,
          attachment.fileId,
          input.senderType,
          input.senderId,
          recipient.type,
          recipient.id,
          "handoff",
          attachment.checksum,
          attachment.scanState,
          attachment.scanLabelsJson,
          "approved_for_handoff",
          attachment.objectRef,
          input.now,
        );
        if (grant.changes > 0) this.recordGrantAudit(input, attachment.fileId, recipient);
      }
    }
  }

  private recordGrantAudit(input: RecordFileHandoffsInput, fileId: string, recipient: MentionTarget): void {
    this.audit.record({
      orgId: input.orgId,
      entityType: "file_object",
      entityId: fileId,
      actorType: input.senderType,
      actorId: input.senderId,
      action: "access_granted",
      payload: {
        messageId: input.messageId,
        threadId: input.threadId,
        grantedToType: recipient.type,
        grantedToId: recipient.id,
      },
    });
  }

  private attachmentGrantRecipients(orgId: string, spaceId: string, mentions: ResolvedMention[]): MentionTarget[] {
    const source = mentions.length > 0 ? mentions.map((mention) => mention.target) : this.spaceRecipients(spaceId);
    const seen = new Set<string>();
    const recipients: MentionTarget[] = [];
    for (const target of source) {
      const key = `${target.type}:${target.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      recipients.push(target);
    }
    if (recipients.length === 0) throw new Error("Attachment grant recipient is required.");
    return recipients.map((recipient) => recipient.type === "org_group" ? recipient : this.requireRecipient(orgId, recipient));
  }

  private requireRecipient(orgId: string, recipient: MentionTarget): MentionTarget {
    if (recipient.type === "board") return recipient;
    const table = recipient.type === "employee" ? "employees" : "agents";
    const row = this.db.prepare(`select id from ${table} where id = ? and org_id = ?`)
      .get(recipient.id, orgId) as { id: string } | undefined;
    if (!row) throw new Error("Attachment grant recipient was not found.");
    return recipient;
  }

  private spaceRecipients(spaceId: string): MentionTarget[] {
    const rows = this.db.prepare(`
      select principal_type, principal_id
      from chat_memberships
      where space_id = ?
      order by principal_type asc, principal_id asc
    `).all(spaceId) as Array<{ principal_type: string; principal_id: string }>;
    return rows.map((row) => {
      if (row.principal_type === "employee" || row.principal_type === "agent") {
        return { type: row.principal_type, id: row.principal_id };
      }
      throw new Error("Chat membership principal type is unsupported.");
    });
  }
}
