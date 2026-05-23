import type {
  AgentRecord,
  ApprovalRecord,
  AuditEventRecord,
  ChatAttachmentRecord,
  ChatMessageRecord,
  ChatSpaceRecord,
  ChatThreadRecord,
  EmployeeRecord,
  FileObjectRecord,
} from "../../../../shared/domain";

export interface MessageContext {
  employees: EmployeeRecord[];
  agents: AgentRecord[];
}

export function senderName(message: ChatMessageRecord, context: MessageContext): string {
  if (message.senderType === "employee") {
    const employee = context.employees.find((item) => item.id === message.senderId);
    if (!employee) throw new Error("Message employee sender is missing.");
    return employee.displayName;
  }
  if (message.senderType === "agent") {
    const agent = context.agents.find((item) => item.id === message.senderId);
    if (!agent) throw new Error("Message agent sender is missing.");
    return agent.name;
  }
  if (message.senderType === "board") return "Board";
  return "System";
}

export function isRootMessage(message: ChatMessageRecord, threads: ChatThreadRecord[]): boolean {
  if (!message.threadId) return true;
  const thread = threads.find((item) => item.id === message.threadId);
  if (!thread) return true;
  return thread.rootMessageId === message.id;
}

export function messageAttachments(
  messageId: string,
  attachments: ChatAttachmentRecord[],
  files: FileObjectRecord[],
): FileObjectRecord[] {
  return attachments
    .filter((attachment) => attachment.messageId === messageId)
    .map((attachment) => files.find((file) => file.id === attachment.fileId))
    .filter((file): file is FileObjectRecord => Boolean(file));
}

export function collectParticipants(
  messages: ChatMessageRecord[],
  employees: EmployeeRecord[],
  agents: AgentRecord[],
): string[] {
  const seen = new Map<string, string>();
  for (const message of messages) {
    if (!message.senderId) continue;
    if (seen.has(message.senderId)) continue;
    if (message.senderType === "employee") {
      const employee = employees.find((item) => item.id === message.senderId);
      if (employee) seen.set(message.senderId, employee.displayName);
    } else if (message.senderType === "agent") {
      const agent = agents.find((item) => item.id === message.senderId);
      if (agent) seen.set(message.senderId, agent.name);
    }
  }
  return [...seen.values()];
}

export function filterApprovalsForSpace(
  approvals: ApprovalRecord[],
  space: ChatSpaceRecord | null,
): ApprovalRecord[] {
  if (!space) return [];
  if (space.name === "board" || space.visibility === "restricted") return approvals;
  return [];
}

export function countMessagesIn(spaceId: string, messages: ChatMessageRecord[]): number {
  return messages.filter((message) => message.spaceId === spaceId).length;
}

export function replayEventsForThread(
  events: AuditEventRecord[],
  thread: ChatThreadRecord,
  messages: ChatMessageRecord[],
): AuditEventRecord[] {
  const messageIds = new Set(
    messages
      .filter((message) => message.threadId === thread.id || message.id === thread.rootMessageId)
      .map((message) => message.id),
  );
  return events
    .filter((event) => {
      if (event.entityType === "chat_message" && messageIds.has(event.entityId)) return true;
      const payload = auditPayload(event);
      return payload.threadId === thread.id || payload.sourceThreadId === thread.id;
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function auditPayload(event: AuditEventRecord): Record<string, unknown> {
  const parsed = JSON.parse(event.payloadJson) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Audit event payload is invalid.");
  }
  return parsed as Record<string, unknown>;
}

export function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const today = new Date();
  if (sameDay(date, today)) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export const SLASH_COMMANDS = ["/agent", "/handoff", "/approve", "/deny", "/skill", "/runbook", "/file", "/escalate"];
