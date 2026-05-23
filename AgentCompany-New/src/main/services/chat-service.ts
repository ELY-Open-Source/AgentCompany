import type { DatabaseSync } from "node:sqlite";
import type { CreateChatSpaceInput, MarkChatSpaceReadInput, SendMessageInput } from "../../shared/commands";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";

const SPACE_TYPES = new Set<CreateChatSpaceInput["spaceType"]>(["company", "department", "project", "direct"]);
const SPACE_VISIBILITIES = new Set<CreateChatSpaceInput["visibility"]>(["workspace", "restricted"]);

interface AttachmentCandidate {
  fileId: string;
  checksum: string;
}

interface SpaceRow {
  id: string;
  org_id: string;
  visibility: string;
  space_type: string;
}

interface PrincipalRef {
  type: "employee" | "agent";
  id: string;
}

export class ChatService {
  private readonly audit: AuditService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
  }

  createSpace(input: CreateChatSpaceInput): string {
    const name = input.name.trim();
    const topic = input.topic.trim();
    if (!name) throw new Error("Chat space name is required.");
    if (!topic) throw new Error("Chat space topic is required.");
    if (!SPACE_TYPES.has(input.spaceType)) throw new Error(`Unsupported chat space type: ${input.spaceType}`);
    if (!SPACE_VISIBILITIES.has(input.visibility)) throw new Error(`Unsupported chat space visibility: ${input.visibility}`);
    const explicitMembers = this.resolveExplicitMembers(input);
    const broadSpace = input.visibility === "workspace" && input.spaceType !== "direct";
    if (!broadSpace && explicitMembers.length === 0) throw new Error("Explicit members are required for this chat space.");

    const id = createId("spc");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into chat_spaces(id, org_id, space_type, name, topic, visibility, created_at)
      values (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.orgId, input.spaceType, name, topic, input.visibility, now);

    const members = broadSpace ? this.resolveWorkspaceMembers(input.orgId) : explicitMembers;
    for (const member of members) this.addMembership(id, member, input.visibility === "restricted" ? "approver" : "member");

    this.audit.record({
      orgId: input.orgId,
      entityType: "chat_space",
      entityId: id,
      actorType: "system",
      actorId: null,
      action: "created",
      payload: { spaceType: input.spaceType, visibility: input.visibility },
    });
    return id;
  }

  sendMessage(input: SendMessageInput): string {
    const body = input.bodyMd.trim();
    if (!body) throw new Error("Message body is required.");
    const space = this.requireSpace(input.orgId, input.spaceId);
    const sender = this.requireSender(input.orgId, input.senderType, input.senderId);
    if (sender) this.requireMembership(space.id, sender);
    if (input.threadId) this.requireThread(input.orgId, input.spaceId, input.threadId);
    const slash = parseSlashInvocation(body);
    if (slash && !ALLOWED_SLASH_COMMANDS.has(slash.command)) throw new Error(`Slash command /${slash.command} is unavailable.`);
    const attachments = this.requireAttachments(input.orgId, input.attachmentFileIds ?? []);

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
    if (slash) this.recordSlashInvocation(id, slash, now);
    this.recordAttachments(id, attachments);
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

  markSpaceRead(input: MarkChatSpaceReadInput): void {
    const space = this.db.prepare("select id from chat_spaces where id = ? and org_id = ?")
      .get(input.spaceId, input.orgId) as { id: string } | undefined;
    if (!space) throw new Error("Chat space was not found.");
    const employee = this.db.prepare("select id from employees where id = ? and org_id = ?")
      .get(input.employeeId, input.orgId) as { id: string } | undefined;
    if (!employee) throw new Error("Employee was not found.");
    this.requireMembership(input.spaceId, { type: "employee", id: input.employeeId });
    const latest = this.db.prepare(`
      select id from chat_messages
      where space_id = ? and org_id = ?
      order by created_at desc
      limit 1
    `).get(input.spaceId, input.orgId) as { id: string } | undefined;
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into chat_read_state(org_id, employee_id, space_id, last_read_message_id, last_read_at)
      values (?, ?, ?, ?, ?)
      on conflict(employee_id, space_id)
      do update set last_read_message_id = excluded.last_read_message_id, last_read_at = excluded.last_read_at
    `).run(input.orgId, input.employeeId, input.spaceId, latest?.id ?? null, now);
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

  private recordSlashInvocation(messageId: string, slash: SlashInvocation, now: string): void {
    this.db.prepare(`
      insert into chat_slash_invocations(id, message_id, command, args_json, result_ref, created_at)
      values (?, ?, ?, ?, ?, ?)
    `).run(createId("slash"), messageId, slash.command, JSON.stringify({ raw: slash.args }), null, now);
  }

  private recordAttachments(messageId: string, attachments: AttachmentCandidate[]): void {
    for (const file of attachments) {
      this.db.prepare(`
        insert into chat_attachments(message_id, file_id, transfer_type, checksum, preview_key)
        values (?, ?, ?, ?, ?)
      `).run(messageId, file.fileId, "handoff", file.checksum, null);
    }
  }

  private requireSpace(orgId: string, spaceId: string): SpaceRow {
    const space = this.db.prepare("select id, org_id, visibility, space_type from chat_spaces where id = ? and org_id = ?")
      .get(spaceId, orgId) as SpaceRow | undefined;
    if (!space) throw new Error("Chat space was not found.");
    return space;
  }

  private requireSender(orgId: string, senderType: SendMessageInput["senderType"], senderId: string | null): PrincipalRef | null {
    if (senderType === "system") return null;
    if (senderType === "employee") {
      if (!senderId) throw new Error("Employee sender is required.");
      this.requireOrgEntity("employees", senderId, orgId, "Employee sender");
      return { type: "employee", id: senderId };
    }
    if (senderType === "agent") {
      if (!senderId) throw new Error("Agent sender is required.");
      this.requireOrgEntity("agents", senderId, orgId, "Agent sender");
      return { type: "agent", id: senderId };
    }
    if (!senderId) throw new Error("Board sender is required.");
    this.requireOrgEntity("employees", senderId, orgId, "Board sender");
    return { type: "employee", id: senderId };
  }

  private requireThread(orgId: string, spaceId: string, threadId: string): void {
    const thread = this.db.prepare("select id from chat_threads where id = ? and org_id = ? and space_id = ?")
      .get(threadId, orgId, spaceId) as { id: string } | undefined;
    if (!thread) throw new Error("Chat thread was not found in this space.");
  }

  private requireAttachments(orgId: string, fileIds: string[]): AttachmentCandidate[] {
    return fileIds.map((fileId) => {
      const file = this.db.prepare("select sha256 from file_objects where id = ? and org_id = ?")
        .get(fileId, orgId) as { sha256: string } | undefined;
      if (!file) throw new Error("Attachment file was not found.");
      return { fileId, checksum: file.sha256 };
    });
  }

  private requireMembership(spaceId: string, principal: PrincipalRef): void {
    const row = this.db.prepare("select space_id from chat_memberships where space_id = ? and principal_type = ? and principal_id = ?")
      .get(spaceId, principal.type, principal.id) as { space_id: string } | undefined;
    if (!row) throw new Error("Chat membership is required.");
  }

  private resolveWorkspaceMembers(orgId: string): PrincipalRef[] {
    const employees = this.db.prepare("select id from employees where org_id = ?").all(orgId) as Array<{ id: string }>;
    const agents = this.db.prepare("select id from agents where org_id = ?").all(orgId) as Array<{ id: string }>;
    return [
      ...employees.map((employee) => ({ type: "employee" as const, id: employee.id })),
      ...agents.map((agent) => ({ type: "agent" as const, id: agent.id })),
    ];
  }

  private resolveExplicitMembers(input: CreateChatSpaceInput): PrincipalRef[] {
    const members: PrincipalRef[] = [];
    for (const id of new Set(input.memberEmployeeIds ?? [])) {
      this.requireOrgEntity("employees", id, input.orgId, "Chat member");
      members.push({ type: "employee", id });
    }
    for (const id of new Set(input.memberAgentIds ?? [])) {
      this.requireOrgEntity("agents", id, input.orgId, "Chat member");
      members.push({ type: "agent", id });
    }
    return members;
  }

  private requireOrgEntity(table: "employees" | "agents", id: string, orgId: string, label: string): void {
    const row = this.db.prepare(`select id from ${table} where id = ? and org_id = ?`).get(id, orgId) as { id: string } | undefined;
    if (!row) throw new Error(`${label} was not found.`);
  }

  private addMembership(spaceId: string, principal: PrincipalRef, role: string): void {
    this.db.prepare(`
      insert into chat_memberships(space_id, principal_type, principal_id, role, mute_state)
      values (?, ?, ?, ?, ?)
    `).run(spaceId, principal.type, principal.id, role, "unmuted");
  }
}

interface SlashInvocation {
  command: string;
  args: string;
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

function parseSlashInvocation(body: string): SlashInvocation | null {
  const match = body.match(/^\/([a-z][a-z0-9_-]*)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  return { command: match[1].toLowerCase(), args: match[2] ?? "" };
}

function createThreadTitle(body: string): string {
  const firstLine = body.split(/\r?\n/, 1)[0].trim();
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}
