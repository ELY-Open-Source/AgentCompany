import type { DatabaseSync } from "node:sqlite";
import type { CreateChatSpaceInput, MarkChatSpaceReadInput, SendMessageInput } from "../../shared/commands";
import { FILE_SCAN_STATE, RISK_LEVEL } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { ApprovalService } from "./approval-service";
import { AuditService } from "./audit-service";
import { canonicalMentionHandle } from "./mention-handles";

const SPACE_TYPES = new Set<CreateChatSpaceInput["spaceType"]>(["company", "department", "project", "direct"]);
const SPACE_VISIBILITIES = new Set<CreateChatSpaceInput["visibility"]>(["workspace", "restricted"]);

interface AttachmentCandidate {
  fileId: string;
  checksum: string;
}

interface FileAttachmentRow {
  id: string;
  sha256: string;
  scan_state: string;
  owner_type: string;
  owner_id: string | null;
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

interface MentionTarget {
  type: "employee" | "agent" | "board" | "org_group";
  id: string;
}

interface MentionCandidate extends MentionTarget {
  handle: string;
}

interface ResolvedMention {
  target: MentionTarget;
  offsetStart: number;
  offsetEnd: number;
}

export class ChatService {
  private readonly audit: AuditService;
  private readonly approvals: ApprovalService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
    this.approvals = new ApprovalService(db);
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
    if (slash) validateSlashInvocation(slash);
    const attachments = this.requireAttachments(input.orgId, input.attachmentFileIds ?? [], sender);
    const mentions = this.resolveMentions(input.orgId, input.spaceId, body);

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
    this.recordMentions(id, mentions);
    const slashResultRef = slash ? this.executeSlashCommand(input, space, sender, slash, id, threadId) : null;
    if (slash) this.recordSlashInvocation(id, slash, slashResultRef, now);
    this.recordAttachments(id, attachments);
    this.recordAttachmentGrants(input, id, threadId, attachments, mentions, now);
    if (input.senderId) {
      const presenceStatus = slash?.command === "escalate" ? "waiting_approval" : "active";
      this.db.prepare(`
        insert into chat_presence(principal_type, principal_id, status, status_text, last_seen_at)
        values (?, ?, ?, ?, ?)
        on conflict(principal_type, principal_id)
        do update set status = excluded.status, status_text = excluded.status_text, last_seen_at = excluded.last_seen_at
      `).run(input.senderType, input.senderId, presenceStatus, "", now);
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

  private resolveMentions(orgId: string, spaceId: string, body: string): ResolvedMention[] {
    const mentions: ResolvedMention[] = [];
    const seen = new Set<string>();
    for (const match of body.matchAll(/(^|\s)@([A-Za-z][A-Za-z0-9_-]{1,63})/g)) {
      const token = match[2];
      const target = this.resolveMention(orgId, spaceId, token);
      const offsetStart = match.index + match[1].length;
      const key = `${target.type}:${target.id}:${offsetStart}`;
      if (seen.has(key)) continue;
      seen.add(key);
      mentions.push({ target, offsetStart, offsetEnd: offsetStart + token.length + 1 });
    }
    return mentions;
  }

  private recordMentions(messageId: string, mentions: ResolvedMention[]): void {
    for (const mention of mentions) {
      this.db.prepare(`
        insert into chat_mentions(message_id, target_type, target_id, offset_start, offset_end)
        values (?, ?, ?, ?, ?)
      `).run(messageId, mention.target.type, mention.target.id, mention.offsetStart, mention.offsetEnd);
    }
  }

  private resolveMention(orgId: string, spaceId: string, token: string): MentionTarget {
    const handles = mentionLookupHandles(token);
    if (handles.has("board")) return { type: "board", id: orgId };
    if (handles.has("oncall")) return { type: "org_group", id: `${orgId}:oncall` };
    const candidates = mentionCandidates(this.db, orgId, spaceId).filter((candidate) => handles.has(candidate.handle));
    const unique = new Map(candidates.map((candidate) => [`${candidate.type}:${candidate.id}`, candidate]));
    if (unique.size === 0) throw new Error(`Mention @${token} could not be resolved.`);
    if (unique.size > 1) throw new Error(`Mention @${token} is ambiguous.`);
    const target = [...unique.values()][0];
    return { type: target.type, id: target.id };
  }

  private executeSlashCommand(
    input: SendMessageInput,
    space: SpaceRow,
    sender: PrincipalRef | null,
    slash: SlashInvocation,
    messageId: string,
    threadId: string,
  ): string | null {
    if (slash.command !== "escalate") return null;
    const requester = approvalRequester(input.senderType, sender);
    return this.approvals.create({
      orgId: input.orgId,
      kind: "chat_escalation",
      title: `Escalate ${spaceName(this.db, space.id)}`,
      details: slash.args.trim(),
      risk: RISK_LEVEL.HIGH,
      requestedByType: requester.type,
      requestedById: requester.id,
    }, { sourceMessageId: messageId, sourceThreadId: threadId });
  }

  private recordSlashInvocation(messageId: string, slash: SlashInvocation, resultRef: string | null, now: string): void {
    this.db.prepare(`
      insert into chat_slash_invocations(id, message_id, command, args_json, result_ref, created_at)
      values (?, ?, ?, ?, ?, ?)
    `).run(createId("slash"), messageId, slash.command, JSON.stringify({ raw: slash.args }), resultRef, now);
  }

  private recordAttachments(messageId: string, attachments: AttachmentCandidate[]): void {
    for (const file of attachments) {
      this.db.prepare(`
        insert into chat_attachments(message_id, file_id, transfer_type, checksum, preview_key)
        values (?, ?, ?, ?, ?)
      `).run(messageId, file.fileId, "handoff", file.checksum, null);
    }
  }

  private recordAttachmentGrants(
    input: SendMessageInput,
    messageId: string,
    threadId: string,
    attachments: AttachmentCandidate[],
    mentions: ResolvedMention[],
    now: string,
  ): void {
    if (attachments.length === 0) return;
    const recipients = this.attachmentGrantRecipients(input.orgId, input.spaceId, mentions);
    const statement = this.db.prepare(`
      insert or ignore into file_access_grants(
        id, org_id, file_id, granted_to_type, granted_to_id, granted_by_type, granted_by_id,
        source_message_id, source_thread_id, access_level, created_at
      )
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const attachment of attachments) {
      for (const recipient of recipients) {
        const result = statement.run(
          createId("fgr"),
          input.orgId,
          attachment.fileId,
          recipient.type,
          recipient.id,
          input.senderType,
          input.senderId,
          messageId,
          threadId,
          "read",
          now,
        );
        if (result.changes > 0) {
          this.audit.record({
            orgId: input.orgId,
            entityType: "file_object",
            entityId: attachment.fileId,
            actorType: input.senderType,
            actorId: input.senderId,
            action: "access_granted",
            payload: { messageId, threadId, grantedToType: recipient.type, grantedToId: recipient.id },
          });
        }
      }
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

  private requireAttachments(orgId: string, fileIds: string[], sender: PrincipalRef | null): AttachmentCandidate[] {
    if (new Set(fileIds).size !== fileIds.length) throw new Error("Attachment file ids must be unique.");
    return fileIds.map((fileId) => {
      const file = this.db.prepare(`
        select id, sha256, scan_state, owner_type, owner_id
        from file_objects
        where id = ? and org_id = ?
      `).get(fileId, orgId) as FileAttachmentRow | undefined;
      if (!file) throw new Error("Attachment file was not found.");
      if (file.scan_state !== FILE_SCAN_STATE.APPROVED) throw new Error("Attachment file is not approved for handoff.");
      if (!this.senderCanReadFile(orgId, file, sender)) throw new Error("Attachment file access is required.");
      return { fileId, checksum: file.sha256 };
    });
  }

  private senderCanReadFile(orgId: string, file: FileAttachmentRow, sender: PrincipalRef | null): boolean {
    if (!sender) return true;
    if (file.owner_type === sender.type && file.owner_id === sender.id) return true;
    const workspaceGroupId = `${orgId}:workspace`;
    const grant = this.db.prepare(`
      select id from file_access_grants
      where org_id = ?
        and file_id = ?
        and access_level in ('read', 'manage')
        and (
          (granted_to_type = ? and granted_to_id = ?)
          or (granted_to_type = 'org_group' and granted_to_id = ?)
        )
      limit 1
    `).get(orgId, file.id, sender.type, sender.id, workspaceGroupId) as { id: string } | undefined;
    return Boolean(grant);
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
    return recipients;
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

interface ApprovalRequester {
  type: "employee" | "agent" | "system";
  id: string | null;
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

function validateSlashInvocation(slash: SlashInvocation): void {
  if (slash.command === "escalate" && slash.args.trim().length === 0) {
    throw new Error("Slash command /escalate requires details.");
  }
}

function approvalRequester(senderType: SendMessageInput["senderType"], sender: PrincipalRef | null): ApprovalRequester {
  if (senderType === "system") return { type: "system", id: null };
  if (!sender) throw new Error("Approval requester is missing.");
  if (senderType === "agent") return { type: "agent", id: sender.id };
  return { type: "employee", id: sender.id };
}

function spaceName(db: DatabaseSync, spaceId: string): string {
  const row = db.prepare("select name from chat_spaces where id = ?").get(spaceId) as { name: string } | undefined;
  if (!row) throw new Error("Chat space was not found.");
  return row.name;
}

function createThreadTitle(body: string): string {
  const firstLine = body.split(/\r?\n/, 1)[0].trim();
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

function mentionCandidates(db: DatabaseSync, orgId: string, spaceId: string): MentionCandidate[] {
  const employees = db.prepare(`
    select employees.id, employees.display_name
    from employees
    join chat_memberships memberships
      on memberships.principal_type = 'employee'
      and memberships.principal_id = employees.id
      and memberships.space_id = ?
    where employees.org_id = ?
  `).all(spaceId, orgId) as Array<{ id: string; display_name: string }>;
  const agents = db.prepare(`
    select agents.id, agents.name
    from agents
    join chat_memberships memberships
      on memberships.principal_type = 'agent'
      and memberships.principal_id = agents.id
      and memberships.space_id = ?
    where agents.org_id = ?
  `).all(spaceId, orgId) as Array<{ id: string; name: string }>;
  return [
    ...employees.flatMap((employee) => principalMentionHandles("employee", employee.id, employee.display_name)),
    ...agents.flatMap((agent) => principalMentionHandles("agent", agent.id, agent.name)),
  ];
}

function principalMentionHandles(type: "employee" | "agent", id: string, name: string): MentionCandidate[] {
  const handles = new Set([canonicalMentionHandle(name), id.toLowerCase()].filter((handle) => handle.length > 0));
  return [...handles].map((handle) => ({ type, id, handle }));
}

function mentionLookupHandles(token: string): Set<string> {
  return new Set([token.toLowerCase(), canonicalMentionHandle(token)].filter((handle) => handle.length > 0));
}
