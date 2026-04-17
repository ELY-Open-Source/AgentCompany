import type { z } from "zod";
import type { ConversationEventRecord, ConversationParticipantRecord, ConversationThreadRecord, ThreadSubscriptionRecord, ThreadWaitStateRecord } from "../../types";
import type { addThreadEventSchema, createThreadSchema, listThreadEventsSchema, listThreadsSchema, listThreadWaitStatesSchema, resolveThreadWaitStateSchema, setThreadWaitStateSchema, threadGetterSchema } from "../schemas-threads";
import type { addParticipantSchema, listParticipantsSchema, removeParticipantSchema } from "../schemas-participants";
import type { listSubscribedThreadsSchema, listSubscriptionsSchema, subscribeThreadSchema, unsubscribeThreadSchema } from "../schemas-subscriptions";
import type { DesktopResult } from "./common";

export type ThreadsApi = {
  createThread: (input: z.infer<typeof createThreadSchema>) => Promise<DesktopResult<ConversationThreadRecord>>;
  listThreads: (input: z.infer<typeof listThreadsSchema>) => Promise<DesktopResult<ConversationThreadRecord[]>>;
  getThread: (input: z.infer<typeof threadGetterSchema>) => Promise<DesktopResult<ConversationThreadRecord>>;
  addThreadEvent: (input: z.infer<typeof addThreadEventSchema>) => Promise<DesktopResult<ConversationEventRecord>>;
  listThreadEvents: (input: z.infer<typeof listThreadEventsSchema>) => Promise<DesktopResult<ConversationEventRecord[]>>;
  setThreadWaitState: (input: z.infer<typeof setThreadWaitStateSchema>) => Promise<DesktopResult<ThreadWaitStateRecord>>;
  resolveThreadWaitState: (input: z.infer<typeof resolveThreadWaitStateSchema>) => Promise<DesktopResult<boolean>>;
  listThreadWaitStates: (input: z.infer<typeof listThreadWaitStatesSchema>) => Promise<DesktopResult<ThreadWaitStateRecord[]>>;
  listParticipants: (input: z.infer<typeof listParticipantsSchema>) => Promise<DesktopResult<ConversationParticipantRecord[]>>;
  addParticipant: (input: z.infer<typeof addParticipantSchema>) => Promise<DesktopResult<ConversationParticipantRecord>>;
  removeParticipant: (input: z.infer<typeof removeParticipantSchema>) => Promise<DesktopResult<boolean>>;
  subscribeThread: (input: z.infer<typeof subscribeThreadSchema>) => Promise<DesktopResult<ThreadSubscriptionRecord>>;
  unsubscribeThread: (input: z.infer<typeof unsubscribeThreadSchema>) => Promise<DesktopResult<boolean>>;
  listSubscriptions: (input: z.infer<typeof listSubscriptionsSchema>) => Promise<DesktopResult<ThreadSubscriptionRecord[]>>;
  listSubscribedThreads: (input: z.infer<typeof listSubscribedThreadsSchema>) => Promise<DesktopResult<ConversationThreadRecord[]>>;
};
