import {
  IPC_CHANNELS,
  listThreadEventsSchema,
  listThreadParticipantsSchema,
  listThreadWaitStatesSchema,
  threadGetterSchema,
} from "@shared/contracts";
import type { RegisterCoreHandlersDependencies } from "./ipc-core-common";
import { fail, ok } from "./ipc-core-common";

export function registerThreadHandlers({ registerHandle, db, ensureCompanyExists }: RegisterCoreHandlersDependencies) {
  registerHandle(IPC_CHANNELS.getThread, async (_event, payload) => {
    const input = threadGetterSchema.parse(payload);
    const companyError = ensureCompanyExists(input.companyId);
    if (companyError) return companyError;
    const thread = db.threads.getThread(input.threadId, input.companyId);
    if (!thread) return fail("THREAD_NOT_FOUND", "Thread not found");
    return ok(thread);
  });

  registerHandle(IPC_CHANNELS.listThreadEvents, async (_event, payload) => {
    const input = listThreadEventsSchema.parse(payload);
    const companyError = ensureCompanyExists(input.companyId);
    if (companyError) return companyError;
    const events = db.threads.listThreadEvents(input.threadId, input.companyId, {
      limit: input.limit,
      offset: input.offset,
    });
    return ok(events);
  });

  registerHandle(IPC_CHANNELS.listThreadWaitStates, async (_event, payload) => {
    const input = listThreadWaitStatesSchema.parse(payload);
    const companyError = ensureCompanyExists(input.companyId);
    if (companyError) return companyError;
    const waitStates = db.threads.listThreadWaitStates(input.companyId, { resolvedOnly: input.resolvedOnly });
    return ok(waitStates);
  });

  registerHandle(IPC_CHANNELS.listThreadParticipants, async (_event, payload) => {
    const input = listThreadParticipantsSchema.parse(payload);
    const companyError = ensureCompanyExists(input.companyId);
    if (companyError) return companyError;
    const thread = db.threads.getThread(input.threadId, input.companyId);
    if (!thread) return fail("THREAD_NOT_FOUND", "Thread not found");
    const participants = db.threads.listParticipants(input.threadId);
    return ok(participants);
  });
}
