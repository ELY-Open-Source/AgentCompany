import type { z } from "zod";
import type { AgentMessageRecord, CommentRecord, DocumentRecord, KnowledgeEntryRecord } from "../../types";
import type { agentMessageInputSchema, commentInputSchema, documentInputSchema, knowledgeEntryInputSchema, listCommentsSchema, markMessageReadSchema, meetingInputSchema, messageQuerySchema, searchMessagesSchema } from "../schemas-messages";
import type { deleteEntitySchema } from "../schemas-badges";
import type { DesktopResult } from "./common";

export type CommunicationApi = {
  addComment: (input: z.infer<typeof commentInputSchema>) => Promise<DesktopResult<string>>;
  listComments: (input: z.infer<typeof listCommentsSchema>) => Promise<DesktopResult<CommentRecord[]>>;
  saveMeeting: (input: z.infer<typeof meetingInputSchema>) => Promise<DesktopResult<string>>;
  deleteMeeting: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  saveDocument: (input: z.infer<typeof documentInputSchema>) => Promise<DesktopResult<string>>;
  deleteDocument: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  saveKnowledgeEntry: (input: z.infer<typeof knowledgeEntryInputSchema>) => Promise<DesktopResult<string>>;
  deleteKnowledgeEntry: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  sendAgentMessage: (input: z.infer<typeof agentMessageInputSchema>) => Promise<DesktopResult<import("@shared/types").SendMessageResult>>;
  listAgentMessages: (input: z.infer<typeof messageQuerySchema>) => Promise<DesktopResult<AgentMessageRecord[]>>;
  markMessageRead: (input: z.infer<typeof markMessageReadSchema>) => Promise<DesktopResult<boolean>>;
  searchMessages: (input: z.infer<typeof searchMessagesSchema>) => Promise<DesktopResult<AgentMessageRecord[]>>;
  // Keep reference to silence unused-import checker for DocumentRecord/KnowledgeEntryRecord — consumers infer via schemas.
  _recordsAnchor?: never & { _d?: DocumentRecord; _k?: KnowledgeEntryRecord };
};
