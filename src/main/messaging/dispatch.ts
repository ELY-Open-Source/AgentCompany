import type { AppDatabase } from "../database";
import type { AgentMessageRecord, DesktopEvent, MessageChannel, MentionResult, SectionId } from "@shared/types";

/**
 * The board reader / human participant ID.
 * When a human sends a message, this is used as the fromAgentId in the
 * underlying agent_messages record. Matches BOARD_READER_ID in database.ts.
 */
export const HUMAN_SENDER_ID = "__board__";

/** Map message priority to notification urgency. Extracted so future priority
 * classes (e.g. "critical") do not drift between message-dispatch and other
 * notification call-sites. */
export function priorityToUrgency(priority: string | null | undefined): "critical" | "informational" {
  return priority === "urgent" ? "critical" : "informational";
}

export interface AgentMessageDispatchInput {
  companyId: string;
  /** Agent ID of the sender. Use HUMAN_SENDER_ID for human-originated messages. */
  fromAgentId: string;
  toAgentId?: string | null;
  channel?: MessageChannel;
  channelTargetId?: string | null;
  subject?: string | null;
  body: string;
  priority?: "urgent" | "normal" | "low";
  parentMessageId?: string | null;
  threadId?: string | null;
  attachmentsJson?: string;
  /** When true, the sender is a human user (fromAgentId === HUMAN_SENDER_ID). */
  fromHumanUser?: boolean;
  /** Optional: target a specific thread wait state for precise checkpoint resolution. */
  waitStateId?: string | null;
}

export interface NormalizedAgentMessageInput {
  companyId: string;
  fromAgentId: string;
  toAgentId: string | null;
  channel: MessageChannel;
  channelTargetId: string | null;
  subject: string;
  body: string;
  priority: "urgent" | "normal" | "low";
  parentMessageId: string | null;
  threadId: string | null;
  attachmentsJson: string;
  fromHumanUser: boolean;
  waitStateId: string | null;
}

export interface MessageValidationError {
  code:
    | "DIRECT_MESSAGE_RECIPIENT_REQUIRED"
    | "SELF_DIRECT_MESSAGE_FORBIDDEN"
    | "NON_DIRECT_MESSAGE_RECIPIENT_FORBIDDEN"
    | "INVALID_COMPANY_REFERENCE"
    | "CHANNEL_TARGET_REQUIRED"
    | "PARENT_MESSAGE_NOT_FOUND";
  message: string;
}

export interface DispatchAgentMessageDependencies {
  db: AppDatabase;
  publishDomainChanged?: () => void;
  wakeAgentIfPossible?: (agentId: string | null | undefined, companyId: string, trigger: string) => string | null;
  /**
   * Attempts to route a persisted message into the recipient's live pi
   * run via `agent.steer()`. Returns true when delivery happened, false
   * when the recipient has no active run. When true, dispatch skips
   * `wakeAgentIfPossible` for that recipient because the message is
   * already in-flight inside the agent loop.
   */
  injectRuntimeMessage?: (recipientAgentId: string, companyId: string, message: AgentMessageRecord) => boolean;
  emitEvent?: (event: DesktopEvent) => void;
  notify?: (options: { title: string; body: string; urgency: "critical" | "informational"; navigation?: { section: SectionId; entityId?: string }; batchKey?: string }) => void;
  /** Called when a human user sends a message. Resolves thread wait states scoped by waitStateId, threadId, or recipient. */
  onHumanMessage?: (companyId: string, toAgentId?: string | null, threadId?: string | null, waitStateId?: string | null) => void;
}

export interface DispatchAgentMessageResult {
  id: string;
  message: AgentMessageRecord | null;
  wakeTargets: string[];
  mentionResults: MentionResult[];
}

function normalizeString(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function truncateForNotification(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function normalizeChannelTargetId(channel: MessageChannel, channelTargetId: string | null | undefined): string | null {
  const target = normalizeString(channelTargetId);
  if (channel === "department" || channel === "project") {
    return target || null;
  }
  return null;
}

export function normalizeAgentMessageInput(input: AgentMessageDispatchInput): NormalizedAgentMessageInput {
  const channel = input.channel ?? "direct";
  const subject = normalizeString(input.subject) || "(no subject)";
  const priority = input.priority ?? "normal";
  const toAgentId = normalizeString(input.toAgentId) || null;
  const channelTargetId = normalizeChannelTargetId(channel, input.channelTargetId);
  const parentMessageId = normalizeString(input.parentMessageId) || null;
  const threadId = normalizeString(input.threadId) || null;
  const attachmentsJson = normalizeString(input.attachmentsJson) || "[]";
  const fromHumanUser = input.fromHumanUser === true || input.fromAgentId === HUMAN_SENDER_ID;

  return {
    companyId: input.companyId,
    fromAgentId: fromHumanUser ? HUMAN_SENDER_ID : input.fromAgentId,
    toAgentId,
    channel,
    channelTargetId,
    subject,
    body: input.body,
    priority,
    parentMessageId,
    threadId,
    attachmentsJson,
    fromHumanUser,
    waitStateId: normalizeString(input.waitStateId) || null,
  };
}

export function validateAgentMessageInput(
  db: AppDatabase,
  input: NormalizedAgentMessageInput,
): MessageValidationError | null {
  // Human sender (BOARD_READER_ID) is always a valid sender — skip agent ownership check.
  if (!input.fromHumanUser && !db.core.settings.belongsToCompany("agents", input.fromAgentId, input.companyId)) {
    return {
      code: "INVALID_COMPANY_REFERENCE",
      message: "The message sender does not belong to the current company.",
    };
  }

  if (input.channel === "direct" && !input.toAgentId) {
    return {
      code: "DIRECT_MESSAGE_RECIPIENT_REQUIRED",
      message: "Direct messages require a recipient agent.",
    };
  }
  if (input.channel === "direct" && input.toAgentId === input.fromAgentId) {
    return {
      code: "SELF_DIRECT_MESSAGE_FORBIDDEN",
      message: "Direct messages require two distinct participants.",
    };
  }
  if (input.channel !== "direct" && input.toAgentId) {
    return {
      code: "NON_DIRECT_MESSAGE_RECIPIENT_FORBIDDEN",
      message: "Only direct messages may set a recipient agent.",
    };
  }

  if (input.toAgentId && input.toAgentId !== HUMAN_SENDER_ID && !db.core.settings.belongsToCompany("agents", input.toAgentId, input.companyId)) {
    return {
      code: "INVALID_COMPANY_REFERENCE",
      message: "The message recipient does not belong to the current company.",
    };
  }

  if (input.channel === "project") {
    if (!input.channelTargetId) {
      return {
        code: "CHANNEL_TARGET_REQUIRED",
        message: "Project messages require a project channel target.",
      };
    }
    if (!db.core.settings.belongsToCompany("projects", input.channelTargetId, input.companyId)) {
      return {
        code: "INVALID_COMPANY_REFERENCE",
        message: "The selected project channel does not belong to the current company.",
      };
    }
  }

  if (input.channel === "department" && !input.channelTargetId) {
    return {
      code: "CHANNEL_TARGET_REQUIRED",
      message: "Department messages require a department channel target.",
    };
  }

  if (input.parentMessageId) {
    const parentMessage = db.core.messages.getAgentMessage(input.parentMessageId, input.companyId);
    if (!parentMessage) {
      return {
        code: "PARENT_MESSAGE_NOT_FOUND",
        message: "The parent message was not found in the current company.",
      };
    }
  }

  return null;
}

function resolveProjectWakeTargets(
  db: AppDatabase,
  input: NormalizedAgentMessageInput,
): string[] {
  if (!input.channelTargetId) return [];
  const project = db.core.entity.getProjectForUpdate(input.channelTargetId, input.companyId);
  const participantIds = new Set<string>();
  if (project?.leadAgentId) participantIds.add(project.leadAgentId);
  for (const assigneeId of db.core.tasks.listProjectTaskAssigneeIds(input.channelTargetId, input.companyId)) {
    participantIds.add(assigneeId);
  }

  if (participantIds.size === 0) return [];
  const ids = Array.from(participantIds).filter((id) => id !== input.fromAgentId);
  if (ids.length === 0) return [];
  return db.core.agents.listActiveAgentIdsFromIds(input.companyId, ids);
}

/** Resolve the agents mentioned in a message body, stripped of the
 *  sender and the human-reader sentinel so downstream consumers never
 *  have to redo those filters. Shared between wake-target resolution
 *  and the mention persistence path so both see the same set. */
export function resolveMentionedAgentIds(
  db: AppDatabase,
  input: Pick<NormalizedAgentMessageInput, "companyId" | "fromAgentId" | "body">,
): string[] {
  const mentioned = db.core.agents.findMentionedAgentIds(input.companyId, input.body);
  const filtered: string[] = [];
  for (const agentId of mentioned) {
    if (!agentId || agentId === input.fromAgentId || agentId === HUMAN_SENDER_ID) continue;
    filtered.push(agentId);
  }
  return filtered;
}

export function resolveMessageWakeTargets(
  db: AppDatabase,
  input: NormalizedAgentMessageInput,
  mentionedAgentIds?: readonly string[],
): string[] {
  const wakeTargets = new Set<string>();
  const mentioned = mentionedAgentIds ?? resolveMentionedAgentIds(db, input);
  const hasExplicitMentions = mentioned.length > 0;

  if (input.channel === "direct" && input.toAgentId && input.toAgentId !== input.fromAgentId) {
    // Chatroom semantics: when the body carries explicit @mentions, the
    // mention list is the recipient list. The DM's `toAgentId` is only
    // woken if the sender named them; otherwise the named agent takes
    // over the turn and the DM partner "keeps working" — exactly the
    // behaviour the operator asks for when they say "@CEO 更新一下进度"
    // inside a chat with 张工程师 and expects CEO (not 张工程师) to
    // answer. With no mentions, preserve the historical "DM always
    // wakes the recipient" contract so every existing flow is intact.
    if (!hasExplicitMentions || mentioned.includes(input.toAgentId)) {
      wakeTargets.add(input.toAgentId);
    }
  }

  if (input.channel === "department" && input.channelTargetId) {
    for (const agentId of db.core.agents.listDepartmentAgentIds(input.companyId, input.channelTargetId)) {
      if (agentId !== input.fromAgentId) wakeTargets.add(agentId);
    }
  }

  if (input.channel === "company") {
    // Company channel is Slack-semantics: every active agent in the
    // workspace is a listener. Board-only fan-outs use the dedicated
    // `incident` channel; the previous top-level-only fan-out made the
    // "company" label a misnomer that silently dropped ICs.
    for (const agentId of db.core.agents.listCompanyBroadcastAgentIds(input.companyId)) {
      if (agentId !== input.fromAgentId) wakeTargets.add(agentId);
    }
  }

  if (input.channel === "project") {
    for (const agentId of resolveProjectWakeTargets(db, input)) {
      wakeTargets.add(agentId);
    }
  }

  if (input.channel === "incident") {
    for (const agentId of db.core.agents.listIncidentPingableAgentIds(input.companyId)) {
      if (agentId !== input.fromAgentId) wakeTargets.add(agentId);
    }
  }

  for (const mentionedId of mentioned) {
    wakeTargets.add(mentionedId);
  }

  // The human participant (`__board__`) is a reader, not a wake-able
  // agent: it has no runtime, no heartbeat, no DB row. Leaving it in the
  // set makes `wakeAgentIfPossible` call `db.core.entity.getAgent("__board__")`,
  // which throws "Agent not found" and spams the log. Filter once, at
  // the point of resolution, so every downstream consumer is clean.
  wakeTargets.delete(HUMAN_SENDER_ID);

  return Array.from(wakeTargets);
}

export function dispatchAgentMessage(
  deps: DispatchAgentMessageDependencies,
  rawInput: AgentMessageDispatchInput,
  wakeTrigger = "message",
): { ok: true; data: DispatchAgentMessageResult } | { ok: false; error: MessageValidationError } {
  const normalized = normalizeAgentMessageInput(rawInput);
  const validationError = validateAgentMessageInput(deps.db, normalized);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  const senderKind = normalized.fromHumanUser ? "human" as const : "agent" as const;
  // Compute @mentions once per dispatch and hand them to both the DB
  // writer (so `agent_message_mentions` is populated atomically with
  // the row) and the wake resolver (so the wake fan-out uses the same
  // set). Two lookups would waste a regex pass and allow the set to
  // drift under mid-dispatch edits.
  const mentionedAgentIds = resolveMentionedAgentIds(deps.db, normalized);
  const persistedMessage = normalized.channel === "direct"
    ? { ...normalized, senderKind, mentionedAgentIds }
    : { ...normalized, toAgentId: null, senderKind, mentionedAgentIds };
  const id = deps.db.core.messages.sendAgentMessage(persistedMessage);
  const message = deps.db.core.messages.getAgentMessage(id, normalized.companyId);
  if (message && deps.emitEvent) {
    deps.emitEvent({ type: "new-message", message });
  }
  deps.publishDomainChanged?.();

  if (
    message &&
    deps.notify &&
    !normalized.fromHumanUser &&
    (message.channel !== "direct" || message.toAgentId === HUMAN_SENDER_ID)
  ) {
    const senderName = deps.db.core.agents.findAgentName(message.fromAgentId) ?? "Agent";
    deps.notify({
      title: truncateForNotification(`${senderName} · ${message.subject}`, 80),
      body: truncateForNotification(message.body, 140),
      urgency: priorityToUrgency(message.priority),
      navigation: { section: "communication", entityId: message.id },
      batchKey: "agent_message",
    });
  }

  // When a human sends a message, resolve thread wait states.
  // Resolution uses precision hierarchy: waitStateId > threadId > toAgentId > company-wide
  if (normalized.fromHumanUser) {
    deps.onHumanMessage?.(normalized.companyId, normalized.toAgentId, normalized.threadId, normalized.waitStateId);
  }

  const wakeTargets = resolveMessageWakeTargets(deps.db, normalized, mentionedAgentIds);
  const mentionResults: MentionResult[] = [];

  if (deps.wakeAgentIfPossible) {
    const agentNameRows = deps.db.core.agents.listAgentNamesByIds(normalized.companyId, wakeTargets);
    const agentNameMap = new Map(agentNameRows.map((a) => [a.id, a.name]));
    for (const wakeTarget of wakeTargets) {
      const agentName = agentNameMap.get(wakeTarget) ?? wakeTarget;
      // Prefer live-loop injection: if the recipient is currently running
      // a pi turn, the message lands in its steering queue and is
      // observed within one turn. When no active run exists, fall back to
      // the inbox + wake pipeline so a sleeping agent is woken with the
      // message queued for its next `prepareRun` cycle.
      const injected = message && deps.injectRuntimeMessage
        ? deps.injectRuntimeMessage(wakeTarget, normalized.companyId, message)
        : false;
      if (injected) {
        mentionResults.push({ agentId: wakeTarget, agentName, outcome: "woken" });
        continue;
      }
      const runId = deps.wakeAgentIfPossible(wakeTarget, normalized.companyId, wakeTrigger);
      const hasQueuedWake = !runId && deps.db.automation.wakeup.listWakeupRequests(normalized.companyId, {
        agentId: wakeTarget,
        limit: 10,
      }).some((request) => request.status === "queued" || request.status === "deferred");
      mentionResults.push({
        agentId: wakeTarget,
        agentName,
        outcome: runId ? "woken" : hasQueuedWake ? "queued" : "busy",
      });
    }
  }

  return {
    ok: true,
    data: {
      id,
      message,
      wakeTargets,
      mentionResults,
    },
  };
}
