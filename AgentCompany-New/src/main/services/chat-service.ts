import type { DatabaseSync } from "node:sqlite";
import type { CreateChatSpaceInput, DeleteMessageInput, EditMessageInput, MarkChatSpaceReadInput, SendMessageInput } from "../../shared/commands";
import {
  CHAT_THREAD_BOARD_STATE,
  FILE_SCAN_STATE,
  ROLE_KEY,
} from "../../shared/domain";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";
import {
  ALLOWED_SLASH_COMMANDS,
  createThreadTitle,
  parseSlashInvocation,
  retentionPolicy,
  validateSlashInvocation,
  type FileAttachmentRow,
  type PrincipalRef,
  type SpaceRow,
  type ThreadRow,
} from "./chat-service-internal";
import { IdentityAccessService } from "./identity-access-service";
import { buildChatMessageStructure } from "./chat-message-structure";
import { ChatMessageMutationService } from "./chat-message-mutation-service";
import { recordChatMentions, resolveChatMentions, type ResolvedMention } from "./chat-mentions";
import { FileHandoffService, type FileHandoffAttachment } from "./file-handoff-service";
import { ChatAgentWakeService } from "./chat-agent-wake-service";
import { ChatSlashRouter } from "./chat-slash-router";

const SPACE_TYPES = new Set<CreateChatSpaceInput["spaceType"]>(["company", "division", "department", "project", "pod", "ad_hoc", "direct"]);
const SPACE_VISIBILITIES = new Set<CreateChatSpaceInput["visibility"]>(["workspace", "restricted"]);

/**
 * How many agent-authored messages a thread may accumulate after the last human
 * message before agent-triggered @mention wake-ups stop. Two agents replying to
 * each other each post a message, so this bounds an autonomous exchange to a
 * finite length and hands control back to a person instead of letting the
 * company talk to itself forever. A human (or board) message in the thread
 * always wakes the mentioned agents and resets this budget.
 */
const MAX_AUTONOMOUS_THREAD_AGENT_TURNS = 16;

export class ChatService {
  private readonly audit: AuditService;
  private readonly handoffs: FileHandoffService;
  private readonly messageMutations: ChatMessageMutationService;
  private readonly identity: IdentityAccessService;
  private readonly agentWake: ChatAgentWakeService;
  private readonly slashRouter: ChatSlashRouter;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
    this.handoffs = new FileHandoffService(db);
    this.messageMutations = new ChatMessageMutationService(db);
    this.identity = new IdentityAccessService(db);
    this.agentWake = new ChatAgentWakeService(db);
    this.slashRouter = new ChatSlashRouter(db, this.audit, this.agentWake);
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
      insert into chat_spaces(id, org_id, space_type, name, topic, visibility, retention_policy, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.orgId, input.spaceType, name, topic, input.visibility, retentionPolicy(input.retentionPolicy, input.visibility), now);

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

  /**
   * Finds or creates the private direct conversation between two principals,
   * so 1:1 traffic (task hand-offs, questions, reports) lives in its own
   * WeChat-style conversation instead of piling into shared channels.
   */
  ensureDirectSpace(orgId: string, a: PrincipalRef, b: PrincipalRef): string {
    if (a.type === b.type && a.id === b.id) throw new Error("A direct conversation needs two different principals.");
    const existing = this.db.prepare(`
      select cs.id
      from chat_spaces cs
      where cs.org_id = ? and cs.space_type = 'direct'
        and exists (select 1 from chat_memberships m where m.space_id = cs.id and m.principal_type = ? and m.principal_id = ?)
        and exists (select 1 from chat_memberships m where m.space_id = cs.id and m.principal_type = ? and m.principal_id = ?)
        and (select count(*) from chat_memberships m where m.space_id = cs.id) = 2
      limit 1
    `).get(orgId, a.type, a.id, b.type, b.id) as { id: string } | undefined;
    if (existing) return existing.id;
    return this.createSpace({
      orgId,
      spaceType: "direct",
      name: `${this.principalDisplayName(orgId, a)} · ${this.principalDisplayName(orgId, b)}`,
      topic: "Direct conversation",
      visibility: "restricted",
      memberEmployeeIds: [a, b].filter((p) => p.type === "employee").map((p) => p.id),
      memberAgentIds: [a, b].filter((p) => p.type === "agent").map((p) => p.id),
    });
  }

  sendMessage(input: SendMessageInput): string {
    const body = input.bodyMd.trim();
    if (!body) throw new Error("Message body is required.");
    const space = this.requireSpace(input.orgId, input.spaceId);
    const sender = this.requireSender(input.orgId, input.senderType, input.senderId);
    if (sender) this.requireMembership(space.id, sender);
    const thread = input.threadId ? this.requireThread(input.orgId, input.spaceId, input.threadId) : null;
    this.assertThreadControl(input, thread, sender);
    const slash = parseSlashInvocation(body);
    if (slash && !ALLOWED_SLASH_COMMANDS.has(slash.command)) throw new Error(`Slash command /${slash.command} is unavailable.`);
    if (slash) validateSlashInvocation(slash);
    const attachmentFileIds = input.attachmentFileIds ?? [];
    const attachments = this.requireAttachments(input.orgId, attachmentFileIds, sender);
    const mentions = resolveChatMentions(this.db, input.orgId, input.spaceId, body);
    const structuredBody = buildChatMessageStructure({ slash, mentions, attachmentFileIds });

    const id = createId("msg");
    const threadId = input.threadId ?? createId("thread");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into chat_messages(
        id, org_id, space_id, thread_id, sender_type, sender_id, body_md, body_structured_json,
        delivery_state, created_at, edited_at, deleted_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.orgId,
      input.spaceId,
      threadId,
      input.senderType,
      input.senderId,
      body,
      structuredBody,
      "sent",
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
    recordChatMentions(this.db, id, mentions);
    const slashResultRef = slash ? this.slashRouter.execute(input, space, sender, mentions, attachments, slash, id, threadId, now) : null;
    if (slash) this.slashRouter.recordInvocation(id, slash, slashResultRef, now);
    if (!slash || slash.command !== "agent") {
      this.wakeAgentMentions(input, mentions, id, threadId, now);
      if (space.space_type === "direct") this.wakeDirectCounterparts(input, mentions, id, threadId, now);
    }
    if (input.senderType === "employee" || input.senderType === "board") {
      this.wakeThreadParticipants(input, mentions, id, threadId, now);
    }
    this.handoffs.record({
      orgId: input.orgId,
      spaceId: input.spaceId,
      messageId: id,
      threadId,
      senderType: input.senderType,
      senderId: input.senderId,
      attachments,
      mentions,
      now,
    });
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
    // Read state is per-employee bookkeeping, not access control: the board
    // observes every conversation in its org (agent↔agent directs included),
    // so opening one clears its unread count even without membership.
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

  editMessage(input: EditMessageInput): void {
    this.messageMutations.editMessage(input);
  }

  deleteMessage(input: DeleteMessageInput): void {
    this.messageMutations.deleteMessage(input);
  }

  private wakeAgentMentions(input: SendMessageInput, mentions: ResolvedMention[], messageId: string, threadId: string, now: string): void {
    const agentMentions = mentions.filter(
      (m) => m.target.type === "agent" && !(input.senderType === "agent" && input.senderId === m.target.id),
    );
    if (agentMentions.length === 0) return;
    if (input.senderType === "agent" && this.autonomousThreadTurnsExhausted(input.orgId, threadId)) return;
    for (const mention of agentMentions) {
      try {
        this.agentWake.wakeFromMention(input, mention.target.id, messageId, threadId, now);
        this.db.prepare(
          "update chat_mentions set wake_state = 'woken' where message_id = ? and target_type = 'agent' and target_id = ?",
        ).run(messageId, mention.target.id);
      } catch {
        this.db.prepare(
          "update chat_mentions set wake_state = 'failed' where message_id = ? and target_type = 'agent' and target_id = ?",
        ).run(messageId, mention.target.id);
      }
    }
  }

  private wakeThreadParticipants(input: SendMessageInput, alreadyMentioned: ResolvedMention[], messageId: string, threadId: string, now: string): void {
    if (!input.threadId) return;
    const mentionedAgentIds = new Set(
      alreadyMentioned.filter((m) => m.target.type === "agent").map((m) => m.target.id),
    );
    const participants = this.db.prepare(`
      select distinct m.sender_id as agent_id
      from chat_messages m
      where m.thread_id = ? and m.org_id = ? and m.sender_type = 'agent' and m.deleted_at is null
    `).all(input.threadId, input.orgId) as Array<{ agent_id: string }>;
    for (const row of participants) {
      if (mentionedAgentIds.has(row.agent_id)) continue;
      try {
        this.agentWake.wakeFromMention(input, row.agent_id, messageId, threadId, now);
      } catch {
        // Agent may not have an enabled provider.
      }
    }
  }

  /**
   * In a direct conversation the counterpart is addressed by definition, so
   * agent members wake on every message without needing an explicit @mention
   * — the same social contract as any messenger. Mentioned agents were
   * already woken; the autonomous turn budget still bounds agent↔agent runs.
   */
  private wakeDirectCounterparts(input: SendMessageInput, mentions: ResolvedMention[], messageId: string, threadId: string, now: string): void {
    if (input.senderType === "agent" && this.autonomousThreadTurnsExhausted(input.orgId, threadId)) return;
    const mentionedAgentIds = new Set(mentions.filter((m) => m.target.type === "agent").map((m) => m.target.id));
    const members = this.db.prepare(`
      select principal_id as agent_id
      from chat_memberships
      where space_id = ? and principal_type = 'agent'
    `).all(input.spaceId) as Array<{ agent_id: string }>;
    for (const member of members) {
      if (mentionedAgentIds.has(member.agent_id)) continue;
      if (input.senderType === "agent" && input.senderId === member.agent_id) continue;
      try {
        this.agentWake.wakeFromMention(input, member.agent_id, messageId, threadId, now);
      } catch {
        // Agent may not have an enabled provider.
      }
    }
  }

  /**
   * True once a thread holds MAX_AUTONOMOUS_THREAD_AGENT_TURNS agent messages
   * since the last human or board message — the point past which agent↔agent
   * wake-ups would loop without human involvement. Counting only the messages
   * after the last human turn lets a person re-engage and grant a fresh budget.
   */
  private autonomousThreadTurnsExhausted(orgId: string, threadId: string): boolean {
    const row = this.db.prepare(`
      select count(*) as turns
      from chat_messages
      where org_id = ? and thread_id = ? and sender_type = 'agent'
        and created_at > coalesce((
          select max(created_at) from chat_messages
          where org_id = ? and thread_id = ? and sender_type in ('employee', 'board')
        ), '')
    `).get(orgId, threadId, orgId, threadId) as { turns: number };
    return row.turns >= MAX_AUTONOMOUS_THREAD_AGENT_TURNS;
  }

  private principalDisplayName(orgId: string, principal: PrincipalRef): string {
    if (principal.type === "agent") {
      const row = this.db.prepare("select name from agents where id = ? and org_id = ?")
        .get(principal.id, orgId) as { name: string } | undefined;
      if (row) return row.name;
    }
    if (principal.type === "employee") {
      const row = this.db.prepare("select display_name from employees where id = ? and org_id = ?")
        .get(principal.id, orgId) as { display_name: string } | undefined;
      if (row) return row.display_name;
    }
    throw new Error("Direct conversation principal was not found.");
  }

  private requireSpace(orgId: string, spaceId: string): SpaceRow {
    const space = this.db.prepare("select id, org_id, visibility, space_type from chat_spaces where id = ? and org_id = ?")
      .get(spaceId, orgId) as SpaceRow | undefined;
    if (!space) throw new Error("Chat space was not found.");
    return space;
  }

  private assertThreadControl(input: SendMessageInput, thread: ThreadRow | null, sender: PrincipalRef | null): void {
    if (!thread) return;
    if (input.senderType === "board") return;
    if (thread.board_state === CHAT_THREAD_BOARD_STATE.FROZEN) {
      throw new Error("Board-frozen thread requires board sender.");
    }
    if (thread.board_state !== CHAT_THREAD_BOARD_STATE.TAKEOVER) return;
    if (!sender) throw new Error("Board takeover controls this thread.");
    if (thread.controlled_by_type === sender.type && thread.controlled_by_id === sender.id) return;
    throw new Error("Board takeover controls this thread.");
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
    this.identity.assertEmployeeRole(
      orgId,
      senderId,
      ROLE_KEY.APPROVAL_DECIDER,
      "chat_board_intervention",
      "organization",
      orgId,
    );
    return { type: "employee", id: senderId };
  }

  private requireThread(orgId: string, spaceId: string, threadId: string): ThreadRow {
    const thread = this.db.prepare(`
      select id, board_state, controlled_by_type, controlled_by_id
      from chat_threads
      where id = ? and org_id = ? and space_id = ?
    `).get(threadId, orgId, spaceId) as ThreadRow | undefined;
    if (!thread) throw new Error("Chat thread was not found in this space.");
    return thread;
  }

  private requireAttachments(orgId: string, fileIds: string[], sender: PrincipalRef | null): FileHandoffAttachment[] {
    if (new Set(fileIds).size !== fileIds.length) throw new Error("Attachment file ids must be unique.");
    return fileIds.map((fileId) => {
      const file = this.db.prepare(`
        select id, sha256, scan_state, scan_labels_json, storage_path, owner_type, owner_id
        from file_objects
        where id = ? and org_id = ?
      `).get(fileId, orgId) as FileAttachmentRow | undefined;
      if (!file) throw new Error("Attachment file was not found.");
      if (file.scan_state !== FILE_SCAN_STATE.APPROVED) throw new Error("Attachment file is not approved for handoff.");
      if (!this.senderCanReadFile(orgId, file, sender)) throw new Error("Attachment file access is required.");
      return {
        fileId,
        checksum: file.sha256,
        scanState: file.scan_state,
        scanLabelsJson: file.scan_labels_json,
        objectRef: file.storage_path,
      };
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
