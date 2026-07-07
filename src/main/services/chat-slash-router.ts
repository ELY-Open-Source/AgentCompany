import type { DatabaseSync } from "node:sqlite";
import type { SendMessageInput } from "../../shared/commands";
import { APPROVAL_STATE, RISK_LEVEL } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { ApprovalService } from "./approval-service";
import type { AuditService } from "./audit-service";
import { BoardInterventionService } from "./board-intervention-service";
import type { ChatAgentWakeService } from "./chat-agent-wake-service";
import {
  approvalRequester,
  firstToken,
  parseApprovalDecisionTarget,
  spaceName,
  type PrincipalRef,
  type SlashInvocation,
  type SpaceRow,
} from "./chat-service-internal";
import type { ResolvedMention } from "./chat-mentions";
import type { FileHandoffAttachment } from "./file-handoff-service";

/**
 * Routes the slash commands a chat message can carry — /board, /approve,
 * /deny, /agent, /skill, /file, /runbook, /handoff, /escalate — to the right
 * domain action and records the routing. Lifted out of ChatService so message
 * delivery and command dispatch each stay a readable, single-purpose unit.
 */
export class ChatSlashRouter {
  private readonly approvals: ApprovalService;
  private readonly boardInterventions: BoardInterventionService;

  constructor(
    private readonly db: DatabaseSync,
    private readonly audit: AuditService,
    private readonly agentWake: ChatAgentWakeService,
  ) {
    this.approvals = new ApprovalService(db);
    this.boardInterventions = new BoardInterventionService(db);
  }

  execute(
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

  recordInvocation(messageId: string, slash: SlashInvocation, resultRef: string | null, now: string): void {
    this.db.prepare(`
      insert into chat_slash_invocations(id, message_id, command, args_json, result_ref, created_at)
      values (?, ?, ?, ?, ?, ?)
    `).run(createId("slash"), messageId, slash.command, JSON.stringify({ raw: slash.args }), resultRef, now);
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
}
