import {
  IPC_CHANNELS,
  agentMessageInputSchema,
  markMessageReadSchema,
  searchMessagesSchema,
} from "@shared/contracts";
import { fail, ok, type RegisterDomainHandlersDependencies } from "./ipc-domain-common";
import { dispatchAgentMessage } from "./messaging/dispatch";

export function registerAgentCoordinationHandlers({
  registerHandle,
  db,
  ensureCompanyExists,
  publishDomainChanged,
  emitEvent,
  notify,
  wakeAgentIfPossible,
  injectRuntimeMessage,
  onHumanMessage,
}: Pick<
  RegisterDomainHandlersDependencies,
  | "registerHandle"
  | "db"
  | "ensureCompanyExists"
  | "publishDomainChanged"
  | "emitEvent"
  | "notify"
  | "wakeAgentIfPossible"
  | "injectRuntimeMessage"
  | "onHumanMessage"
>) {
  registerHandle(IPC_CHANNELS.sendAgentMessage, async (_event, payload) => {
    const parsed = agentMessageInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const dispatchResult = dispatchAgentMessage(
      {
        db,
        emitEvent,
        notify,
        publishDomainChanged,
        wakeAgentIfPossible,
        injectRuntimeMessage,
        onHumanMessage,
      },
      parsed,
      "message",
    );
    if (!dispatchResult.ok) {
      return fail(dispatchResult.error.code, dispatchResult.error.message);
    }
    return ok({
      id: dispatchResult.data.id,
      mentionResults: dispatchResult.data.mentionResults,
    });
  });

  registerHandle(IPC_CHANNELS.markMessageRead, async (_event, payload) => {
    const parsed = markMessageReadSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const message = db.core.messages.getAgentMessage(parsed.messageId, parsed.companyId);
    if (!message) {
      return fail("MESSAGE_NOT_FOUND", "Message not found in the current company.");
    }
    if (parsed.readerAgentId && !db.core.settings.belongsToCompany("agents", parsed.readerAgentId, parsed.companyId)) {
      return fail("INVALID_COMPANY_REFERENCE", "The selected message reader does not belong to the current company.");
    }
    if (parsed.readerAgentId) {
      const visibleToReader = db.core.messages
        .listAgentMessages(parsed.companyId, {
          agentId: parsed.readerAgentId,
          messageId: parsed.messageId,
          limit: 1,
        })
        .some((entry) => entry.id === parsed.messageId);
      if (!visibleToReader) {
        return fail("MESSAGE_NOT_VISIBLE", "This message is not visible to the selected reader.");
      }
    }
    db.core.messages.markMessageReadForReader(parsed.messageId, parsed.companyId, parsed.readerAgentId ?? null);
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.searchMessages, async (_event, payload) => {
    const parsed = searchMessagesSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    return ok(db.core.messages.searchMessages(parsed.companyId, parsed.query, {
      channel: parsed.channel,
      channelTargetId: parsed.channelTargetId,
      limit: parsed.limit,
    }));
  });

}
