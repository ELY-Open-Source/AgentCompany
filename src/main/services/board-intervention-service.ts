import type { DatabaseSync } from "node:sqlite";
import type { SendMessageInput } from "../../shared/commands";
import {
  BOARD_INTERVENTION_ACTION,
  BOARD_INTERVENTION_MODE,
  CHAT_THREAD_BOARD_STATE,
  RISK_LEVEL,
  type BoardInterventionAction,
  type BoardInterventionMode,
} from "../../shared/domain";
import { createId } from "../../shared/ids";
import type { ResolvedMention } from "./chat-mentions";
import { ApprovalService } from "./approval-service";
import { AuditService } from "./audit-service";

interface PrincipalRef {
  type: "employee" | "agent";
  id: string;
}

interface ApprovalRequester {
  type: "employee" | "agent" | "system";
  id: string | null;
}

interface BoardCommand {
  mode: BoardInterventionMode;
  action: BoardInterventionAction;
  details: string;
}

interface BoardTarget {
  type: "employee" | "agent" | "board";
  id: string;
}

export interface RecordBoardInterventionInput {
  messageInput: SendMessageInput;
  sender: PrincipalRef | null;
  mentions: ResolvedMention[];
  args: string;
  messageId: string;
  threadId: string;
  spaceId: string;
  now: string;
}

export class BoardInterventionService {
  private readonly audit: AuditService;
  private readonly approvals: ApprovalService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
    this.approvals = new ApprovalService(db);
  }

  record(input: RecordBoardInterventionInput): string {
    if (input.messageInput.senderType !== "board") throw new Error("Board intervention requires board sender.");
    const command = parseBoardCommand(input.args);
    const target = resolveBoardTarget(command, input.messageInput.orgId, input.mentions);
    const approvalId = command.action === BOARD_INTERVENTION_ACTION.FORCE_APPROVAL
      ? this.createBoardApproval(input, command)
      : null;
    const interventionId = createId("bdi");
    this.db.prepare(`
      insert into board_interventions(
        id, org_id, thread_id, message_id, mode, action, details, target_type, target_id,
        approval_id, created_by_type, created_by_id, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      interventionId,
      input.messageInput.orgId,
      input.threadId,
      input.messageId,
      command.mode,
      command.action,
      command.details,
      target.type,
      target.id,
      approvalId,
      input.messageInput.senderType,
      input.messageInput.senderId,
      input.now,
    );
    this.applyBoardThreadState(input, command, target);
    this.audit.record({
      orgId: input.messageInput.orgId,
      entityType: "board_intervention",
      entityId: interventionId,
      actorType: input.messageInput.senderType,
      actorId: input.messageInput.senderId,
      action: "recorded",
      payload: {
        threadId: input.threadId,
        messageId: input.messageId,
        mode: command.mode,
        action: command.action,
        targetType: target.type,
        targetId: target.id,
        approvalId,
      },
    });
    return interventionId;
  }

  private createBoardApproval(input: RecordBoardInterventionInput, command: BoardCommand): string {
    const requester = approvalRequester(input.messageInput.senderType, input.sender);
    return this.approvals.create({
      orgId: input.messageInput.orgId,
      kind: "board_force_approval",
      title: `Board approval ${spaceName(this.db, input.spaceId)}`,
      details: command.details,
      risk: RISK_LEVEL.HIGH,
      requestedByType: requester.type,
      requestedById: requester.id,
    }, {
      sourceMessageId: input.messageId,
      sourceThreadId: input.threadId,
      sourceEntityType: "chat_message",
      sourceEntityId: input.messageId,
    });
  }

  private applyBoardThreadState(input: RecordBoardInterventionInput, command: BoardCommand, target: BoardTarget): void {
    if (command.action === BOARD_INTERVENTION_ACTION.FREEZE) {
      this.updateBoardThreadState(input, CHAT_THREAD_BOARD_STATE.FROZEN, null, null);
      return;
    }
    if (command.action === BOARD_INTERVENTION_ACTION.TAKEOVER) {
      this.updateBoardThreadState(input, CHAT_THREAD_BOARD_STATE.TAKEOVER, target.type, target.id);
      return;
    }
    if (command.action === BOARD_INTERVENTION_ACTION.ROLLBACK) {
      this.updateBoardThreadState(input, CHAT_THREAD_BOARD_STATE.OPEN, null, null);
    }
  }

  private updateBoardThreadState(
    input: RecordBoardInterventionInput,
    boardState: string,
    controlledByType: BoardTarget["type"] | null,
    controlledById: string | null,
  ): void {
    this.db.prepare(`
      update chat_threads
      set board_state = ?, controlled_by_type = ?, controlled_by_id = ?, updated_at = ?
      where id = ? and org_id = ?
    `).run(boardState, controlledByType, controlledById, input.now, input.threadId, input.messageInput.orgId);
    this.audit.record({
      orgId: input.messageInput.orgId,
      entityType: "chat_thread",
      entityId: input.threadId,
      actorType: "board",
      actorId: input.messageInput.senderId,
      action: "board_state_changed",
      payload: { threadId: input.threadId, boardState, controlledByType, controlledById },
    });
  }
}

export function parseBoardCommand(args: string): BoardCommand {
  const trimmed = args.trim();
  if (!trimmed) throw new Error("Slash command /board requires an action.");
  const [rawAction = "", ...rest] = trimmed.split(/\s+/);
  const action = normalizeBoardAction(rawAction);
  const details = rest.join(" ").trim();
  if (!details) throw new Error(`Slash command /board ${rawAction} requires details.`);
  return {
    mode: boardModeFor(action, rawAction),
    action,
    details,
  };
}

function resolveBoardTarget(command: BoardCommand, orgId: string, mentions: ResolvedMention[]): BoardTarget {
  if (command.action !== BOARD_INTERVENTION_ACTION.TAKEOVER) return { type: "board", id: orgId };
  const principal = mentions.find((mention) => mention.target.type === "employee" || mention.target.type === "agent");
  if (!principal) return { type: "board", id: orgId };
  if (principal.target.type === "employee" || principal.target.type === "agent") {
    return { type: principal.target.type, id: principal.target.id };
  }
  return { type: "board", id: orgId };
}

function normalizeBoardAction(value: string): BoardInterventionAction {
  const normalized = value.toLowerCase().replace(/-/g, "_");
  if (normalized === "observe") return BOARD_INTERVENTION_ACTION.DECISION;
  if (normalized === BOARD_INTERVENTION_ACTION.DECISION) return BOARD_INTERVENTION_ACTION.DECISION;
  if (normalized === BOARD_INTERVENTION_ACTION.FREEZE) return BOARD_INTERVENTION_ACTION.FREEZE;
  if (normalized === BOARD_INTERVENTION_ACTION.TAKEOVER) return BOARD_INTERVENTION_ACTION.TAKEOVER;
  if (normalized === BOARD_INTERVENTION_ACTION.ROLLBACK) return BOARD_INTERVENTION_ACTION.ROLLBACK;
  if (normalized === BOARD_INTERVENTION_ACTION.FORCE_APPROVAL) return BOARD_INTERVENTION_ACTION.FORCE_APPROVAL;
  throw new Error(`Unsupported board action: ${value}.`);
}

function boardModeFor(action: BoardInterventionAction, rawAction: string): BoardInterventionMode {
  if (rawAction.toLowerCase() === "observe") return BOARD_INTERVENTION_MODE.OBSERVE;
  if (action === BOARD_INTERVENTION_ACTION.TAKEOVER) return BOARD_INTERVENTION_MODE.TAKEOVER;
  return BOARD_INTERVENTION_MODE.INTERVENE;
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
