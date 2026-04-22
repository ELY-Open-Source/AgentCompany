import { IPC_CHANNELS, deleteEntitySchema, meetingInputSchema } from "@shared/contracts";
import { fail, ok } from "../ipc-domain-common";
import type { CompanyOperationHandlerDependencies } from "./types";

export function registerMeetingHandlers({
  registerHandle,
  db,
  ensureCompanyExists,
  findInvalidReference,
  publishDomainChanged,
  logger,
}: CompanyOperationHandlerDependencies) {
  registerHandle(IPC_CHANNELS.saveMeeting, async (_event, payload) => {
    const parsed = meetingInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;

    let participantAgentIds: string[] = [];
    try {
      const parsedParticipantIds = JSON.parse(parsed.participantAgentIds);
      participantAgentIds = Array.isArray(parsedParticipantIds)
        ? parsedParticipantIds.filter((value): value is string => typeof value === "string")
        : [];
    } catch (err) {
      logger.warn(`[ipc/meetings] Meeting participants JSON parse failed:`, err instanceof Error ? err.message : String(err));
      return fail("INVALID_PARTICIPANTS", "Meeting participants must be valid JSON.");
    }

    const invalidReference = findInvalidReference(parsed.companyId, [
      { id: parsed.organizerAgentId, table: "agents", label: "meeting organizer" },
      ...participantAgentIds.map((agentId) => ({ id: agentId, table: "agents", label: "meeting participant" })),
    ]);
    if (invalidReference) {
      return fail("INVALID_COMPANY_REFERENCE", `The selected ${invalidReference.label} does not belong to the current company.`);
    }

    const id = db.core.knowledge.saveMeeting(parsed);
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.deleteMeeting, async (_event, payload) => {
    const parsed = deleteEntitySchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.core.settings.belongsToCompany("meetings", parsed.id, parsed.companyId)) {
      return fail("ENTITY_NOT_FOUND", "Meeting not found in the current company.");
    }
    db.core.knowledge.deleteMeeting(parsed.id, parsed.companyId);
    publishDomainChanged();
    return ok(true);
  });
}
