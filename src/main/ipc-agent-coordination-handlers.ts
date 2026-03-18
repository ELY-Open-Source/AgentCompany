import {
  IPC_CHANNELS,
  agentMessageInputSchema,
  autoAssignSchema,
  markMessageReadSchema,
  messageQuerySchema,
} from "@shared/contracts";
import { fail, ok, type RegisterDomainHandlersDependencies } from "./ipc-domain-common";

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
    if (parsed.channel === "direct" && !parsed.toAgentId) {
      return fail("DIRECT_MESSAGE_RECIPIENT_REQUIRED", "Direct messages require a recipient agent.");
    }
    const invalidReference = findInvalidReference(parsed.companyId, [
      { id: parsed.fromAgentId, table: "agents", label: "message sender" },
      { id: parsed.toAgentId, table: "agents", label: "message recipient" },
      { id: parsed.channel === "project" ? parsed.channelTargetId : null, table: "projects", label: "project channel" },
    ]);
    if (invalidReference) {
      return fail("INVALID_COMPANY_REFERENCE", `The selected ${invalidReference.label} does not belong to the current company.`);
    }
    const id = db.sendAgentMessage(parsed);
    const message = db.getAgentMessage(id, parsed.companyId);
    if (message) {
      emitEvent({ type: "new-message", message });
    }
    publishDomainChanged();
    if (parsed.toAgentId) {
      wakeAgentIfPossible(parsed.toAgentId, parsed.companyId, "message");
    }
    if (parsed.channel === "department" && parsed.channelTargetId) {
      const departmentAgents = db.getIdleAgentsForDepartment(parsed.companyId, parsed.channelTargetId);
      for (const agent of departmentAgents.filter((entry: { id: string }) => entry.id !== parsed.fromAgentId)) {
        wakeAgentIfPossible(agent.id, parsed.companyId, "message");
      }
    }
    if (parsed.channel === "company") {
      const ceo = db.listSnapshot().agents.find((agent: { companyId: string; reportsTo: string | null; status: string }) =>
        agent.companyId === parsed.companyId && !agent.reportsTo && agent.status !== "terminated",
      );
      if (ceo && ceo.id !== parsed.fromAgentId) {
        wakeAgentIfPossible(ceo.id, parsed.companyId, "message");
      }
    }
    return ok(id);
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
    if (!db.getAgentMessage(parsed.messageId, parsed.companyId)) {
      return fail("MESSAGE_NOT_FOUND", "Message not found in the current company.");
    }
    if (parsed.readerAgentId && !db.belongsToCompany("agents", parsed.readerAgentId, parsed.companyId)) {
      return fail("INVALID_COMPANY_REFERENCE", "The selected message reader does not belong to the current company.");
    }
    db.markMessageReadForReader(parsed.messageId, parsed.companyId, parsed.readerAgentId ?? null);
    return ok(true);
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
