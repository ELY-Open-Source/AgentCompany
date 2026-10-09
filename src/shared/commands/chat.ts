export interface SendMessageInput {
  orgId: string;
  spaceId: string;
  threadId: string | null;
  senderType: "employee" | "agent" | "board" | "system";
  senderId: string | null;
  bodyMd: string;
  attachmentFileIds?: string[];
}

export interface EditMessageInput {
  orgId: string;
  messageId: string;
  actorType: SendMessageInput["senderType"];
  actorId: string | null;
  bodyMd: string;
}

export interface DeleteMessageInput {
  orgId: string;
  messageId: string;
  actorType: SendMessageInput["senderType"];
  actorId: string | null;
}

export interface CreateChatSpaceInput {
  orgId: string;
  spaceType: "company" | "division" | "department" | "project" | "pod" | "ad_hoc" | "direct";
  name: string;
  topic: string;
  visibility: "workspace" | "restricted";
  retentionPolicy?: "standard_365d" | "restricted_365d";
  memberEmployeeIds?: string[];
  memberAgentIds?: string[];
}

export interface MarkChatSpaceReadInput {
  orgId: string;
  employeeId: string;
  spaceId: string;
  /** The newest message the reader actually saw; later arrivals stay unread. */
  upToMessageId: string;
}
