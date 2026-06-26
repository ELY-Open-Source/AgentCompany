import type { DatabaseSync } from "node:sqlite";
import type { CreateChatSpaceInput, DeleteMessageInput, EditMessageInput, MarkChatSpaceReadInput, SendMessageInput } from "../../shared/commands";
import {
  APPROVAL_STATE,
  CHAT_THREAD_BOARD_STATE,
  FILE_SCAN_STATE,
  RISK_LEVEL,
  ROLE_KEY,
} from "../../shared/domain";
import { createId } from "../../shared/ids";
import { ApprovalService } from "./approval-service";
import { AuditService } from "./audit-service";
import { BoardInterventionService } from "./board-intervention-service";
import {
  ALLOWED_SLASH_COMMANDS,
  approvalRequester,
  createThreadTitle,
  firstToken,
  parseApprovalDecisionTarget,
  parseSlashInvocation,
  retentionPolicy,
  spaceName,
  validateSlashInvocation,
  type FileAttachmentRow,
  type PrincipalRef,
  type SlashInvocation,
  type SpaceRow,
  type ThreadRow,
} from "./chat-service-internal";
import { IdentityAccessService } from "./identity-access-service";
import { buildChatMessageStructure } from "./chat-message-structure";
import { ChatMessageMutationService } from "./chat-message-mutation-service";
import { recordChatMentions, resolveChatMentions, type ResolvedMention } from "./chat-mentions";
import { FileHandoffService, type FileHandoffAttachment } from "./file-handoff-service";
import { ChatAgentWakeService } from "./chat-agent-wake-service";

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
  private readonly approvals: ApprovalService;
  private readonly boardInterventions: BoardInterventionService;
  private readonly handoffs: FileHandoffService;
  private readonly messageMutations: ChatMessageMutationService;
  private readonly identity: IdentityAccessService;
  private readonly agentWake: ChatAgentWakeService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
    this.approvals = new ApprovalService(db);
    this.boardInterventions = new BoardInterventionService(db);
    this.handoffs = new FileHandoffService(db);
    this.messageMutations = new ChatMessageMutationService(db);
    this.identity = new IdentityAccessService(db);
    this.agentWake = new ChatAgentWakeService(db);
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
    const slashResultRef = slash ? this.executeSlashCommand(input, space, sender, mentions, attachments, slash, id, threadId, now) : null;
    if (slash) this.recordSlashInvocation(id, slash, slashResultRef, now);
    if (!slash || slash.command !== "agent") {
      this.wakeAgentMentions(input, mentions, id, threadId, now);
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

  editMessage(input: EditMessageInput): void {
    this.messageMutations.editMessage(input);
  }

  deleteMessage(input: DeleteMessageInput): void {
    this.messageMutations.deleteMessage(input);
  }

  private executeSlashCommand(
    input: SendMessageInput,
    space: SpaceRow,
    sender: PrincipalRef | null,
    mentions: ResolvedMention[],
    attachments: FileHandoffAttachment[],
    slash: SlashInvocation,
    messageId: string,
    threadId: string,
    now: string,
  ): string | null {
    if (slash.command === "board") {
      return this.boardInterventions.record({
        messageInput: input,
        sender,
        mentions,
        args: slash.args,
        messageId,
        threadId,
        spaceId: space.id,
        now,
      });
    }
    if (slash.command === "approve" || slash.command === "deny") {
      return this.decideApprovalFromSlash(input, sender, slash);
    }
    if (slash.command === "agent") return this.routeAgentSlash(input, mentions, slash, messageId, threadId, now);
    if (slash.command === "skill") return this.routeSkillSlash(input, slash, messageId);
    if (slash.command === "file") return this.routeFileSlash(input, attachments, slash, messageId);
    if (slash.command === "runbook") return this.routeRunbookSlash(input, attachments, slash, messageId);
    if (slash.command === "handoff") return this.routeHandoffSlash(input, attachments, messageId);
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
    }, { sourceMessageId: messageId, sourceThreadId: threadId, sourceEntityType: "chat_message", sourceEntityId: messageId });
  }

  private routeAgentSlash(
    input: SendMessageInput,
    mentions: ResolvedMention[],
    slash: SlashInvocation,
    messageId: string,
    threadId: string,
    now: string,
  ): string {
    const wake = this.agentWake.wakeFromSlash(input, mentions, slash, messageId, threadId, now);
    this.recordSlashRoute(input, messageId, slash.command, wake.targetId, {
      targetType: "agent",
      targetId: wake.targetId,
      taskId: wake.taskId,
      runId: wake.runId,
    });
    return wake.targetId;
  }

  private routeSkillSlash(input: SendMessageInput, slash: SlashInvocation, messageId: string): string {
    const target = firstToken(slash.args);
    if (!target) throw new Error("Slash command /skill requires a skill slug.");
    const row = this.db.prepare(`
      select id from skill_definitions
      where org_id = ?
        and (lower(slug) = lower(?) or lower(name) = lower(?))
      limit 1
    `).get(input.orgId, target, target.replace(/-/g, " ")) as { id: string } | undefined;
    if (!row) throw new Error("Slash command /skill target was not found.");
    this.recordSlashRoute(input, messageId, slash.command, row.id, { skillId: row.id, target });
    return row.id;
  }

  private routeFileSlash(
    input: SendMessageInput,
    attachments: FileHandoffAttachment[],
    slash: SlashInvocation,
    messageId: string,
  ): string {
    const fileId = attachments[0]?.fileId ?? this.resolveFileSlashTarget(input.orgId, slash);
    this.recordSlashRoute(input, messageId, slash.command, fileId, { fileId });
    return fileId;
  }

  private routeRunbookSlash(
    input: SendMessageInput,
    attachments: FileHandoffAttachment[],
    slash: SlashInvocation,
    messageId: string,
  ): string {
    if (!slash.args.trim() && attachments.length === 0) throw new Error("Slash command /runbook requires details or a file attachment.");
    const resultRef = attachments[0]?.fileId ?? messageId;
    this.recordSlashRoute(input, messageId, slash.command, resultRef, { resultRef, attachmentCount: attachments.length });
    return resultRef;
  }

  private routeHandoffSlash(input: SendMessageInput, attachments: FileHandoffAttachment[], messageId: string): string {
    const fileId = attachments[0]?.fileId;
    if (!fileId) throw new Error("Slash command /handoff requires a file attachment.");
    this.recordSlashRoute(input, messageId, "handoff", fileId, { fileId, attachmentCount: attachments.length });
    return fileId;
  }

  private resolveFileSlashTarget(orgId: string, slash: SlashInvocation): string {
    const target = firstToken(slash.args);
    if (!target) throw new Error("Slash command /file requires a file attachment or file reference.");
    const row = this.db.prepare(`
      select id from file_objects
      where org_id = ?
        and (id = ? or name = ?)
      order by created_at desc
      limit 1
    `).get(orgId, target, target) as { id: string } | undefined;
    if (!row) throw new Error("Slash command /file target was not found.");
    return row.id;
  }

  private recordSlashRoute(
    input: SendMessageInput,
    messageId: string,
    command: string,
    resultRef: string,
    route: Record<string, unknown>,
  ): void {
    this.audit.record({
      orgId: input.orgId,
      entityType: "chat_message",
      entityId: messageId,
      actorType: input.senderType,
      actorId: input.senderId,
      action: "slash_routed",
      payload: { command, resultRef, route },
    });
  }

  private decideApprovalFromSlash(input: SendMessageInput, sender: PrincipalRef | null, slash: SlashInvocation): string {
    if (!sender || sender.type !== "employee") throw new Error("Approval decision requires employee sender.");
    const approvalId = parseApprovalDecisionTarget(slash);
    this.approvals.decide({
      orgId: input.orgId,
      approvalId,
      state: slash.command === "approve" ? APPROVAL_STATE.APPROVED : APPROVAL_STATE.DECLINED,
      decidedByEmployeeId: sender.id,
    });
    return approvalId;
  }

  private recordSlashInvocation(messageId: string, slash: SlashInvocation, resultRef: string | null, now: string): void {
    this.db.prepare(`
      insert into chat_slash_invocations(id, message_id, command, args_json, result_ref, created_at)
      values (?, ?, ?, ?, ?, ?)
    `).run(createId("slash"), messageId, slash.command, JSON.stringify({ raw: slash.args }), resultRef, now);
  }

  private wakeAgentMentions(input: SendMessageInput, mentions: ResolvedMention[], messageId: string, threadId: string, now: string): void {
    const agentMentions = mentions.filter(
      (m) => m.target.type === "agent" && !(input.senderType === "agent" && input.senderId === m.target.id),
    );
    if (agentMentions.length === 0) return;
    // An agent's own message must not keep waking teammates once the thread has
    // run its autonomous budget; only a human re-entering the thread can.
    if (input.senderType === "agent" && this.autonomousThreadTurnsExhausted(input.orgId, threadId)) return;
    for (const mention of agentMentions) {
      try {
        this.agentWake.wakeFromMention(input, mention.target.id, messageId, threadId, now);
      } catch {
        // Agent may lack an enabled provider or service identity; skip silently.
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
