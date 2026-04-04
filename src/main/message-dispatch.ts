import type { AppDatabase } from "./database";
import type { AgentMessageRecord, DesktopEvent, MessageChannel, MentionResult, SectionId } from "@shared/types";

/**
 * The board reader / human participant ID.
 * When a human sends a message, this is used as the fromAgentId in the
 * underlying agent_messages record. Matches BOARD_READER_ID in database.ts.
 */
export const HUMAN_SENDER_ID = "__board__";

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
  if (!input.fromHumanUser && !db.belongsToCompany("agents", input.fromAgentId, input.companyId)) {
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
  if (input.channel !== "direct" && input.toAgentId) {
    return {
      code: "NON_DIRECT_MESSAGE_RECIPIENT_FORBIDDEN",
      message: "Only direct messages may set a recipient agent.",
    };
  }

  if (input.toAgentId && input.toAgentId !== HUMAN_SENDER_ID && !db.belongsToCompany("agents", input.toAgentId, input.companyId)) {
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
    if (!db.belongsToCompany("projects", input.channelTargetId, input.companyId)) {
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
    const parentMessage = db.getAgentMessage(input.parentMessageId, input.companyId);
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
  input: NormalizedAgentMessageInput,
  snapshot: ReturnType<AppDatabase["listSnapshot"]>,
): string[] {
  if (!input.channelTargetId) return [];
  const project = snapshot.projects.find(
    (entry) => entry.id === input.channelTargetId && entry.companyId === input.companyId,
  );
  const participantIds = new Set<string>();
  if (project?.leadAgentId) participantIds.add(project.leadAgentId);
  for (const task of snapshot.tasks) {
    if (task.companyId !== input.companyId) continue;
    if (task.projectId !== input.channelTargetId) continue;
    if (task.assigneeAgentId) participantIds.add(task.assigneeAgentId);
  }

  return Array.from(participantIds).filter((agentId) => {
    if (agentId === input.fromAgentId) return false;
    const agent = snapshot.agents.find((entry) => entry.id === agentId);
    return Boolean(agent && agent.companyId === input.companyId && agent.status !== "terminated");
  });
}

export function resolveMessageWakeTargets(
  db: AppDatabase,
  input: NormalizedAgentMessageInput,
): string[] {
  const snapshot = db.listSnapshot();
  const wakeTargets = new Set<string>();

  if (input.channel === "direct" && input.toAgentId && input.toAgentId !== input.fromAgentId) {
    wakeTargets.add(input.toAgentId);
  }

  if (input.channel === "department" && input.channelTargetId) {
    for (const agent of snapshot.agents) {
      if (agent.companyId !== input.companyId) continue;
      if (agent.status === "terminated") continue;
      if (agent.id === input.fromAgentId) continue;
      if (agent.department === input.channelTargetId) {
        wakeTargets.add(agent.id);
      }
    }
  }

  if (input.channel === "company") {
    const topLevel = snapshot.agents.filter(
      (agent) => agent.companyId === input.companyId && !agent.reportsTo && agent.status !== "terminated",
    );
    for (const agent of topLevel) {
      if (agent.id !== input.fromAgentId) {
        wakeTargets.add(agent.id);
      }
    }
  }

  if (input.channel === "project") {
    for (const agentId of resolveProjectWakeTargets(input, snapshot)) {
      wakeTargets.add(agentId);
    }
  }

  if (input.channel === "incident") {
    for (const agent of snapshot.agents) {
      if (agent.companyId !== input.companyId) continue;
      if (agent.status === "terminated" || agent.status === "pending_approval") continue;
      if (agent.id === input.fromAgentId) continue;
      wakeTargets.add(agent.id);
    }
  }

  // Parse @mentions in message body and wake mentioned agents
  const mentionedIds = db.findMentionedAgentIds(input.companyId, input.body);
  for (const mentionedId of mentionedIds) {
    if (mentionedId !== input.fromAgentId) {
      wakeTargets.add(mentionedId);
    }
  }

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
  const persistedMessage = normalized.channel === "direct"
    ? { ...normalized, senderKind }
    : { ...normalized, toAgentId: null, senderKind };
  const id = deps.db.sendAgentMessage(persistedMessage);
  const message = deps.db.getAgentMessage(id, normalized.companyId);
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
    const snapshot = deps.db.listSnapshot();
    const senderName = snapshot.agents.find((entry) => entry.id === message.fromAgentId)?.name ?? "Agent";
    deps.notify({
      title: truncateForNotification(`${senderName} · ${message.subject}`, 80),
      body: truncateForNotification(message.body, 140),
      urgency: message.priority === "urgent" ? "critical" : "informational",
      navigation: { section: "communication", entityId: message.id },
      batchKey: "agent_message",
    });
  }

  // When a human sends a message, resolve thread wait states.
  // Resolution uses precision hierarchy: waitStateId > threadId > toAgentId > company-wide
  if (normalized.fromHumanUser) {
    deps.onHumanMessage?.(normalized.companyId, normalized.toAgentId, normalized.threadId, normalized.waitStateId);
  }

  const wakeTargets = resolveMessageWakeTargets(deps.db, normalized);
  const mentionResults: MentionResult[] = [];

  if (deps.wakeAgentIfPossible) {
    const snapshot = deps.db.listSnapshot();
    for (const wakeTarget of wakeTargets) {
      const agent = snapshot.agents.find((a) => a.id === wakeTarget && a.companyId === normalized.companyId);
      const agentName = agent?.name ?? wakeTarget;
      const runId = deps.wakeAgentIfPossible(wakeTarget, normalized.companyId, wakeTrigger);
      const hasQueuedWake = !runId && deps.db.listWakeupRequests(normalized.companyId, {
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
