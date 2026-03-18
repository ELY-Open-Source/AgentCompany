import type { AppDatabase } from "./database";
import type { AgentMessageRecord, DesktopEvent, MessageChannel } from "@shared/types";

export interface AgentMessageDispatchInput {
  companyId: string;
  fromAgentId: string;
  toAgentId?: string | null;
  channel?: MessageChannel;
  channelTargetId?: string | null;
  subject?: string | null;
  body: string;
  priority?: "urgent" | "normal" | "low";
  parentMessageId?: string | null;
  attachmentsJson?: string;
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
  attachmentsJson: string;
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
}

export interface DispatchAgentMessageResult {
  id: string;
  message: AgentMessageRecord | null;
  wakeTargets: string[];
}

function normalizeString(value: string | null | undefined): string {
  return value?.trim() ?? "";
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
  const attachmentsJson = normalizeString(input.attachmentsJson) || "[]";

  return {
    companyId: input.companyId,
    fromAgentId: input.fromAgentId,
    toAgentId,
    channel,
    channelTargetId,
    subject,
    body: input.body,
    priority,
    parentMessageId,
    attachmentsJson,
  };
}

export function validateAgentMessageInput(
  db: AppDatabase,
  input: NormalizedAgentMessageInput,
): MessageValidationError | null {
  if (!db.belongsToCompany("agents", input.fromAgentId, input.companyId)) {
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

  if (input.toAgentId && !db.belongsToCompany("agents", input.toAgentId, input.companyId)) {
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

  const persistedMessage = normalized.channel === "direct"
    ? normalized
    : { ...normalized, toAgentId: null };
  const id = deps.db.sendAgentMessage(persistedMessage);
  const message = deps.db.getAgentMessage(id, normalized.companyId);
  if (message && deps.emitEvent) {
    deps.emitEvent({ type: "new-message", message });
  }
  deps.publishDomainChanged?.();

  const wakeTargets = resolveMessageWakeTargets(deps.db, normalized);
  if (deps.wakeAgentIfPossible) {
    for (const wakeTarget of wakeTargets) {
      deps.wakeAgentIfPossible(wakeTarget, normalized.companyId, wakeTrigger);
    }
  }

  return {
    ok: true,
    data: {
      id,
      message,
      wakeTargets,
    },
  };
}
