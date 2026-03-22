import {
  IPC_CHANNELS,
  agentMessageInputSchema,
  autoAssignSchema,
  markMessageReadSchema,
  messageQuerySchema,
  searchMessagesSchema,
} from "@shared/contracts";
import { fail, ok, type RegisterDomainHandlersDependencies } from "./ipc-domain-common";
import { dispatchAgentMessage } from "./message-dispatch";

export function registerAgentCoordinationHandlers({
  registerHandle,
  db,
  ensureCompanyExists,
  findInvalidReference,
  publishDomainChanged,
  emitEvent,
  wakeAgentIfPossible,
}: Pick<
  RegisterDomainHandlersDependencies,
  | "registerHandle"
  | "db"
  | "ensureCompanyExists"
  | "findInvalidReference"
  | "publishDomainChanged"
  | "emitEvent"
  | "wakeAgentIfPossible"
>) {
  registerHandle(IPC_CHANNELS.sendAgentMessage, async (_event, payload) => {
    const parsed = agentMessageInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const dispatchResult = dispatchAgentMessage(
      {
        db,
        emitEvent,
        publishDomainChanged,
        wakeAgentIfPossible,
      },
      parsed,
      "message",
    );
    if (!dispatchResult.ok) {
      return fail(dispatchResult.error.code, dispatchResult.error.message);
    }
    return ok(dispatchResult.data.id);
  });

  registerHandle(IPC_CHANNELS.listAgentMessages, async (_event, payload) => {
    const parsed = messageQuerySchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const invalidReference = findInvalidReference(parsed.companyId, [
      { id: parsed.agentId, table: "agents", label: "message reader" },
      { id: parsed.channel === "project" ? parsed.channelTargetId : null, table: "projects", label: "project channel" },
    ]);
    if (invalidReference) {
      return fail("INVALID_COMPANY_REFERENCE", `The selected ${invalidReference.label} does not belong to the current company.`);
    }
    return ok(db.listAgentMessages(parsed.companyId, {
      agentId: parsed.agentId,
      channel: parsed.channel,
      channelTargetId: parsed.channelTargetId,
      unreadOnly: parsed.unreadOnly,
      limit: parsed.limit,
    }));
  });

  registerHandle(IPC_CHANNELS.markMessageRead, async (_event, payload) => {
    const parsed = markMessageReadSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const message = db.getAgentMessage(parsed.messageId, parsed.companyId);
    if (!message) {
      return fail("MESSAGE_NOT_FOUND", "Message not found in the current company.");
    }
    if (parsed.readerAgentId && !db.belongsToCompany("agents", parsed.readerAgentId, parsed.companyId)) {
      return fail("INVALID_COMPANY_REFERENCE", "The selected message reader does not belong to the current company.");
    }
    if (parsed.readerAgentId) {
      const visibleToReader = db
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
    db.markMessageReadForReader(parsed.messageId, parsed.companyId, parsed.readerAgentId ?? null);
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.searchMessages, async (_event, payload) => {
    const parsed = searchMessagesSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    return ok(db.searchMessages(parsed.companyId, parsed.query, {
      channel: parsed.channel,
      channelTargetId: parsed.channelTargetId,
      limit: parsed.limit,
    }));
  });

  registerHandle(IPC_CHANNELS.autoAssignTask, async (_event, payload) => {
    const parsed = autoAssignSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const agentId = db.autoAssignTask(parsed.taskId, parsed.companyId);
    if (!agentId) {
      return fail("NO_AVAILABLE_AGENT", "No available agent could be found for this task.");
    }
    publishDomainChanged();
    return ok(agentId);
  });
}
