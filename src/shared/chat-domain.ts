import type { ChatThreadBoardState } from "./board-domain";

export interface ChatSpaceRecord {
  id: string;
  orgId: string;
  spaceType: string;
  name: string;
  topic: string;
  visibility: string;
  retentionPolicy: string;
  createdAt: string;
}

export interface ChatMessageRecord {
  id: string;
  orgId: string;
  spaceId: string;
  threadId: string | null;
  senderType: "employee" | "agent" | "board" | "system";
  senderId: string | null;
  bodyMd: string;
  bodyStructuredJson: string;
  deliveryState: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface ChatMembershipRecord {
  spaceId: string;
  principalType: "employee" | "agent";
  principalId: string;
  role: string;
  muteState: string;
}

export interface ChatThreadRecord {
  id: string;
  orgId: string;
  spaceId: string;
  rootMessageId: string | null;
  title: string;
  state: string;
  boardState: ChatThreadBoardState;
  controlledByType: "employee" | "agent" | "board" | null;
  controlledById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatAttachmentRecord {
  messageId: string;
  fileId: string;
  transferType: string;
  checksum: string;
  previewKey: string | null;
}

export interface ChatMentionRecord {
  messageId: string;
  targetType: "employee" | "agent" | "board" | "org_group";
  targetId: string;
  offsetStart: number;
  offsetEnd: number;
  wakeState: "none" | "woken" | "failed";
}

export interface ChatSlashInvocationRecord {
  id: string;
  messageId: string;
  command: string;
  argsJson: string;
  resultRef: string | null;
  createdAt: string;
}

export interface ChatPresenceRecord {
  principalType: string;
  principalId: string;
  status: string;
  statusText: string;
  lastSeenAt: string;
}

export interface ChatReadStateRecord {
  orgId: string;
  employeeId: string;
  spaceId: string;
  lastReadMessageId: string | null;
  lastReadAt: string;
}

/** One thread in full, loaded on demand because the snapshot holds only recent chat. */
export interface ThreadHistory {
  messages: ChatMessageRecord[];
  attachments: ChatAttachmentRecord[];
  mentions: ChatMentionRecord[];
  slashInvocations: ChatSlashInvocationRecord[];
}

/** One page of a conversation's older messages, oldest first, and whether still older ones exist. */
export interface SpaceHistoryPage extends ThreadHistory {
  /** The threads these messages belong to, which the snapshot may no longer hold. */
  threads: ChatThreadRecord[];
  replyStatuses: ChatReplyStatus[];
  hasMore: boolean;
}

/** Where one agent's reply to a message stands: waiting carries the hold's reason and resume time, expired and failed say why. */
export type ChatReplyStatus = { messageId: string; agentId: string } & (
  | { state: "queued" | "running" | "replied"; detail: null; resumesAt: null }
  | { state: "waiting"; detail: string; resumesAt: string | null }
  | { state: "expired" | "failed"; detail: string; resumesAt: null }
  | { state: "stopped"; detail: string | null; resumesAt: null }
);
