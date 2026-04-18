import type { z } from "zod";
import type { ConversationEventRecord, ConversationThreadRecord, ThreadWaitStateRecord } from "../../types";
import type { listThreadEventsSchema, listThreadWaitStatesSchema, threadGetterSchema } from "../schemas-threads";
import type { DesktopResult } from "./common";

export type ThreadsApi = {
  getThread: (input: z.infer<typeof threadGetterSchema>) => Promise<DesktopResult<ConversationThreadRecord>>;
  listThreadEvents: (input: z.infer<typeof listThreadEventsSchema>) => Promise<DesktopResult<ConversationEventRecord[]>>;
  listThreadWaitStates: (input: z.infer<typeof listThreadWaitStatesSchema>) => Promise<DesktopResult<ThreadWaitStateRecord[]>>;
};
