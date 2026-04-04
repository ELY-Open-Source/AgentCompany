import {
  IPC_CHANNELS,
  addThreadEventSchema,
  addParticipantSchema,
  createThreadSchema,
  listParticipantsSchema,
  listSubscriptionsSchema,
  listSubscribedThreadsSchema,
  listThreadEventsSchema,
  listThreadWaitStatesSchema,
  listThreadsSchema,
  removeParticipantSchema,
  resolveThreadWaitStateSchema,
  setThreadWaitStateSchema,
  subscribeThreadSchema,
  threadGetterSchema,
  unsubscribeThreadSchema,
} from "@shared/contracts";
import type { RegisterCoreHandlersDependencies } from "./ipc-core-common";
import { fail, ok } from "./ipc-core-common";

export function registerThreadHandlers({ registerHandle, db, ensureCompanyExists, publishDomainChanged, emitEvent }: RegisterCoreHandlersDependencies) {
  registerHandle(IPC_CHANNELS.createThread, async (_event, payload) => {
    try {
      const input = createThreadSchema.parse(payload);
      const companyError = ensureCompanyExists(input.companyId);
      if (companyError) return companyError;
      const thread = db.createThread({
        companyId: input.companyId,
        title: input.title,
        type: input.type,
        relatedEntityType: input.relatedEntityType ?? null,
        relatedEntityId: input.relatedEntityId ?? null,
      });
      publishDomainChanged();
      return ok(thread);
    } catch (error) {
      return fail("THREAD_CREATE_FAILED", error instanceof Error ? error.message : "Failed to create thread");
    }
  });

  registerHandle(IPC_CHANNELS.listThreads, async (_event, payload) => {
    try {
      const input = listThreadsSchema.parse(payload);
      const companyError = ensureCompanyExists(input.companyId);
      if (companyError) return companyError;
      const threads = db.listThreads({
        companyId: input.companyId,
        type: input.type,
        relatedEntityType: input.relatedEntityType,
        relatedEntityId: input.relatedEntityId,
        limit: input.limit,
        offset: input.offset,
      });
      return ok(threads);
    } catch (error) {
      return fail("THREAD_LIST_FAILED", error instanceof Error ? error.message : "Failed to list threads");
    }
  });

  registerHandle(IPC_CHANNELS.getThread, async (_event, payload) => {
    try {
      const input = threadGetterSchema.parse(payload);
      const companyError = ensureCompanyExists(input.companyId);
      if (companyError) return companyError;
      const thread = db.getThread(input.threadId, input.companyId);
      if (!thread) return fail("THREAD_NOT_FOUND", "Thread not found");
      return ok(thread);
    } catch (error) {
      return fail("THREAD_GET_FAILED", error instanceof Error ? error.message : "Failed to get thread");
    }
  });

  registerHandle(IPC_CHANNELS.addThreadEvent, async (_event, payload) => {
    try {
      const input = addThreadEventSchema.parse(payload);
      const companyError = ensureCompanyExists(input.companyId);
      if (companyError) return companyError;
      const event = db.addThreadEvent({
        threadId: input.threadId,
        actorId: input.actorId,
        actorType: input.actorType,
        eventType: input.eventType,
        body: input.body,
        metadataJson: input.metadataJson,
      });
      publishDomainChanged();
      emitEvent({ type: "domain-changed" });
      return ok(event);
    } catch (error) {
      return fail("THREAD_EVENT_ADD_FAILED", error instanceof Error ? error.message : "Failed to add thread event");
    }
  });

  registerHandle(IPC_CHANNELS.listThreadEvents, async (_event, payload) => {
    try {
      const input = listThreadEventsSchema.parse(payload);
      const companyError = ensureCompanyExists(input.companyId);
      if (companyError) return companyError;
      const events = db.listThreadEvents(input.threadId, input.companyId, {
        limit: input.limit,
        offset: input.offset,
      });
      return ok(events);
    } catch (error) {
      return fail("THREAD_EVENTS_LIST_FAILED", error instanceof Error ? error.message : "Failed to list thread events");
    }
  });

  registerHandle(IPC_CHANNELS.setThreadWaitState, async (_event, payload) => {
    try {
      const input = setThreadWaitStateSchema.parse(payload);
      const companyError = ensureCompanyExists(input.companyId);
      if (companyError) return companyError;
      const waitState = db.setThreadWaitState({
        threadId: input.threadId,
        companyId: input.companyId,
        waitingFor: input.waitingFor,
        relatedApprovalId: input.relatedApprovalId ?? null,
        reason: input.reason,
      });
      publishDomainChanged();
      emitEvent({
        type: "thread-wait-state-updated",
        threadId: input.threadId,
        companyId: input.companyId,
        waitStateId: waitState.id,
        action: "created",
      });
      return ok(waitState);
    } catch (error) {
      return fail("THREAD_WAIT_STATE_SET_FAILED", error instanceof Error ? error.message : "Failed to set thread wait state");
    }
  });

  registerHandle(IPC_CHANNELS.resolveThreadWaitState, async (_event, payload) => {
    try {
      const input = resolveThreadWaitStateSchema.parse(payload);
      const companyError = ensureCompanyExists(input.companyId);
      if (companyError) return companyError;

      // Query the wait state before resolving to capture its threadId for the event
      const waitStates = db.listThreadWaitStates(input.companyId);
      const target = waitStates.find((ws) => ws.id === input.waitStateId);
      if (!target) return fail("THREAD_WAIT_STATE_NOT_FOUND", "Wait state not found");

      db.resolveThreadWaitState(input.waitStateId, input.companyId);
      publishDomainChanged();
      emitEvent({
        type: "thread-wait-state-updated",
        threadId: target.threadId,
        companyId: input.companyId,
        waitStateId: input.waitStateId,
        action: "resolved",
      });
      return ok(true);
    } catch (error) {
      return fail("THREAD_WAIT_STATE_RESOLVE_FAILED", error instanceof Error ? error.message : "Failed to resolve thread wait state");
    }
  });

  registerHandle(IPC_CHANNELS.listThreadWaitStates, async (_event, payload) => {
    try {
      const input = listThreadWaitStatesSchema.parse(payload);
      const companyError = ensureCompanyExists(input.companyId);
      if (companyError) return companyError;
      const waitStates = db.listThreadWaitStates(input.companyId, { resolvedOnly: input.resolvedOnly });
      return ok(waitStates);
    } catch (error) {
      return fail("THREAD_WAIT_STATES_LIST_FAILED", error instanceof Error ? error.message : "Failed to list thread wait states");
    }
  });

  registerHandle(IPC_CHANNELS.listParticipants, async (_event, payload) => {
    try {
      const input = listParticipantsSchema.parse(payload);
      const thread = db.getThread(input.threadId, input.companyId);
      if (!thread) return fail("THREAD_NOT_FOUND", "Thread not found in this company");
      const participants = db.listParticipants(input.threadId);
      return ok(participants);
    } catch (error) {
      return fail("PARTICIPANTS_LIST_FAILED", error instanceof Error ? error.message : "Failed to list participants");
    }
  });

  registerHandle(IPC_CHANNELS.addParticipant, async (_event, payload) => {
    try {
      const input = addParticipantSchema.parse(payload);
      const thread = db.getThread(input.threadId, input.companyId);
      if (!thread) return fail("THREAD_NOT_FOUND", "Thread not found in this company");
      const participant = db.addParticipant({
        threadId: input.threadId,
        participantId: input.participantId,
        participantType: input.participantType,
        role: input.role,
      });
      publishDomainChanged();
      return ok(participant);
    } catch (error) {
      return fail("PARTICIPANT_ADD_FAILED", error instanceof Error ? error.message : "Failed to add participant");
    }
  });

  registerHandle(IPC_CHANNELS.removeParticipant, async (_event, payload) => {
    try {
      const input = removeParticipantSchema.parse(payload);
      const thread = db.getThread(input.threadId, input.companyId);
      if (!thread) return fail("THREAD_NOT_FOUND", "Thread not found in this company");
      db.removeParticipant(input.threadId, input.participantId);
      publishDomainChanged();
      return ok(true);
    } catch (error) {
      return fail("PARTICIPANT_REMOVE_FAILED", error instanceof Error ? error.message : "Failed to remove participant");
    }
  });

  registerHandle(IPC_CHANNELS.subscribeThread, async (_event, payload) => {
    try {
      const input = subscribeThreadSchema.parse(payload);
      const thread = db.getThread(input.threadId, input.companyId);
      if (!thread) return fail("THREAD_NOT_FOUND", "Thread not found in this company");
      const subscription = db.subscribe({
        threadId: input.threadId,
        subscriberId: input.subscriberId,
        subscriberType: input.subscriberType,
        notifyOn: input.notifyOn,
      });
      publishDomainChanged();
      return ok(subscription);
    } catch (error) {
      return fail("THREAD_SUBSCRIBE_FAILED", error instanceof Error ? error.message : "Failed to subscribe to thread");
    }
  });

  registerHandle(IPC_CHANNELS.unsubscribeThread, async (_event, payload) => {
    try {
      const input = unsubscribeThreadSchema.parse(payload);
      const thread = db.getThread(input.threadId, input.companyId);
      if (!thread) return fail("THREAD_NOT_FOUND", "Thread not found in this company");
      db.unsubscribe(input.threadId, input.subscriberId);
      publishDomainChanged();
      return ok(true);
    } catch (error) {
      return fail("THREAD_UNSUBSCRIBE_FAILED", error instanceof Error ? error.message : "Failed to unsubscribe from thread");
    }
  });

  registerHandle(IPC_CHANNELS.listSubscriptions, async (_event, payload) => {
    try {
      const input = listSubscriptionsSchema.parse(payload);
      const thread = db.getThread(input.threadId, input.companyId);
      if (!thread) return fail("THREAD_NOT_FOUND", "Thread not found in this company");
      const subscriptions = db.listSubscriptions(input.threadId);
      return ok(subscriptions);
    } catch (error) {
      return fail("SUBSCRIPTIONS_LIST_FAILED", error instanceof Error ? error.message : "Failed to list subscriptions");
    }
  });

  registerHandle(IPC_CHANNELS.listSubscribedThreads, async (_event, payload) => {
    try {
      const input = listSubscribedThreadsSchema.parse(payload);
      const threads = db.listSubscribedThreads(input.subscriberId, input.companyId);
      return ok(threads);
    } catch (error) {
      return fail("SUBSCRIBED_THREADS_LIST_FAILED", error instanceof Error ? error.message : "Failed to list subscribed threads");
    }
  });
}
