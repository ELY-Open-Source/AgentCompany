import type {
  AgentRecord,
  ApprovalRecord,
  ChatAttachmentRecord,
  ChatMembershipRecord,
  ChatMessageRecord,
  ChatReadStateRecord,
  ChatSpaceRecord,
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

export interface ConversationCounterpart {
  type: "agent" | "employee";
  id: string;
  name: string;
}

/** One row of the WeChat-style conversation list. */
export interface ConversationItem {
  space: ChatSpaceRecord;
  title: string;
  isDirect: boolean;
  /** The other party of a direct conversation, when there is exactly one. */
  counterpart: ConversationCounterpart | null;
  preview: string | null;
  lastActivityAt: string;
  unread: number;
}

/**
 * Folds spaces, messages, memberships, and per-employee read state into the
 * conversation list: every channel and direct conversation as its own row,
 * newest activity first, with a preview line and an unread count.
 */
export function buildConversations(input: {
  spaces: ChatSpaceRecord[];
  memberships: ChatMembershipRecord[];
  messages: ChatMessageRecord[];
  readStates: ChatReadStateRecord[];
  employees: EmployeeRecord[];
  agents: AgentRecord[];
  currentEmployeeId: string;
}): ConversationItem[] {
  const lastBySpace = new Map<string, ChatMessageRecord>();
  const countsSince = new Map<string, number>();
  const lastReadBySpace = new Map<string, string>();
  for (const state of input.readStates) {
    if (state.employeeId === input.currentEmployeeId) lastReadBySpace.set(state.spaceId, state.lastReadAt);
  }
  for (const message of input.messages) {
    lastBySpace.set(message.spaceId, message);
    if (message.senderType === "employee" && message.senderId === input.currentEmployeeId) continue;
    const lastRead = lastReadBySpace.get(message.spaceId);
    if (lastRead && message.createdAt <= lastRead) continue;
    countsSince.set(message.spaceId, (countsSince.get(message.spaceId) ?? 0) + 1);
  }
  const membersBySpace = new Map<string, ChatMembershipRecord[]>();
  for (const membership of input.memberships) {
    const group = membersBySpace.get(membership.spaceId);
    if (group) group.push(membership);
    else membersBySpace.set(membership.spaceId, [membership]);
  }
  const context: MessageContext = { employees: input.employees, agents: input.agents };

  const items = input.spaces.map((space) => {
    const last = lastBySpace.get(space.id) ?? null;
    const isDirect = space.spaceType === "direct";
    const counterpart = isDirect
      ? resolveCounterpart(membersBySpace.get(space.id) ?? [], input)
      : null;
    return {
      space,
      title: isDirect && counterpart ? counterpart.name : space.name,
      isDirect,
      counterpart,
      preview: last ? `${senderName(last, context)}: ${previewText(last)}` : null,
      lastActivityAt: last?.createdAt ?? space.createdAt,
      unread: countsSince.get(space.id) ?? 0,
    };
  });
  return items.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

/**
 * The single other party of a direct conversation, from the viewer's seat.
 * Conversations between two agents have no single counterpart for the
 * observing board member; those rows keep the space's own two-name title.
 */
function resolveCounterpart(
  members: ChatMembershipRecord[],
  input: { employees: EmployeeRecord[]; agents: AgentRecord[]; currentEmployeeId: string },
): ConversationCounterpart | null {
  const others = members.filter(
    (member) => !(member.principalType === "employee" && member.principalId === input.currentEmployeeId),
  );
  if (others.length !== members.length - 1) return null;
  const named = others
    .map((member): ConversationCounterpart | null => {
      if (member.principalType === "agent") {
        const agent = input.agents.find((item) => item.id === member.principalId);
        return agent ? { type: "agent", id: agent.id, name: agent.name } : null;
      }
      if (member.principalType === "employee") {
        const employee = input.employees.find((item) => item.id === member.principalId);
        return employee ? { type: "employee", id: employee.id, name: employee.displayName } : null;
      }
      return null;
    })
    .filter((item): item is ConversationCounterpart => item !== null);
  return named.length === 1 ? named[0] : null;
}

function previewText(message: ChatMessageRecord): string {
  if (message.deletedAt) return "Message deleted";
  const firstLine = message.bodyMd.split("\n").find((line) => line.trim()) ?? "";
  return firstLine.trim();
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
