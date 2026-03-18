import {
  IPC_CHANNELS,
  deleteEntitySchema,
  documentInputSchema,
  knowledgeEntryInputSchema,
  meetingInputSchema,
  sprintInputSchema,
} from "@shared/contracts";
import { fail, ok, type RegisterDomainHandlersDependencies } from "./ipc-domain-common";

const COMPANY_SCOPED_REFERENCE_TABLES = new Set([
  "agents",
  "goals",
  "projects",
  "tasks",
  "approvals",
  "runs",
  "secrets",
  "meetings",
  "documents",
  "knowledge_base",
  "sprints",
  "automation_rules",
  "workflow_pipelines",
]);

export function registerContentOperationsHandlers({
  registerHandle,
  db,
  ensureCompanyExists,
  findInvalidReference,
  publishDomainChanged,
  wakeAgentIfPossible,
  dispatchAutomation,
}: Pick<
  RegisterDomainHandlersDependencies,
  | "registerHandle"
  | "db"
  | "ensureCompanyExists"
  | "findInvalidReference"
  | "publishDomainChanged"
  | "wakeAgentIfPossible"
  | "dispatchAutomation"
>) {
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
    } catch {
      return fail("INVALID_PARTICIPANTS", "Meeting participants must be valid JSON.");
    }
    const invalidReference = findInvalidReference(parsed.companyId, [
      { id: parsed.organizerAgentId, table: "agents", label: "meeting organizer" },
      ...participantAgentIds.map((agentId) => ({ id: agentId, table: "agents", label: "meeting participant" })),
    ]);
    if (invalidReference) {
      return fail("INVALID_COMPANY_REFERENCE", `The selected ${invalidReference.label} does not belong to the current company.`);
    }
    const id = db.saveMeeting(parsed);
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.deleteMeeting, async (_event, payload) => {
    const parsed = deleteEntitySchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("meetings", parsed.id, parsed.companyId)) {
      return fail("ENTITY_NOT_FOUND", "Meeting not found in the current company.");
    }
    db.deleteMeeting(parsed.id, parsed.companyId);
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.saveDocument, async (_event, payload) => {
    const parsed = documentInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const invalidReference = findInvalidReference(parsed.companyId, [
      { id: parsed.authorAgentId, table: "agents", label: "document author" },
      { id: parsed.reviewerAgentId, table: "agents", label: "document reviewer" },
      { id: parsed.projectId, table: "projects", label: "document project" },
      { id: parsed.goalId, table: "goals", label: "document goal" },
      { id: parsed.parentDocId, table: "documents", label: "parent document" },
    ]);
    if (invalidReference) {
      return fail("INVALID_COMPANY_REFERENCE", `The selected ${invalidReference.label} does not belong to the current company.`);
    }
    const isNew = !parsed.id;
    const id = db.saveDocument(parsed);
    if (isNew) {
      dispatchAutomation("document_created", {
        companyId: parsed.companyId,
        agentId: parsed.authorAgentId ?? undefined,
        projectId: parsed.projectId ?? undefined,
      });
      if (parsed.authorAgentId && parsed.reviewerAgentId) {
        wakeAgentIfPossible(parsed.reviewerAgentId, parsed.companyId, "assignment");
      }
    }
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.deleteDocument, async (_event, payload) => {
    const parsed = deleteEntitySchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("documents", parsed.id, parsed.companyId)) {
      return fail("ENTITY_NOT_FOUND", "Document not found in the current company.");
    }
    db.deleteDocument(parsed.id, parsed.companyId);
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.saveKnowledgeEntry, async (_event, payload) => {
    const parsed = knowledgeEntryInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const knowledgeReferences = [
      { id: parsed.authorAgentId, table: "agents", label: "knowledge author" },
      ...(parsed.referencedEntityId && parsed.referencedEntityType
        && COMPANY_SCOPED_REFERENCE_TABLES.has(parsed.referencedEntityType)
        ? [{ id: parsed.referencedEntityId, table: parsed.referencedEntityType, label: "referenced entity" }]
        : []),
    ];
    const invalidReference = findInvalidReference(parsed.companyId, [
      ...knowledgeReferences,
    ]);
    if (invalidReference) {
      return fail("INVALID_COMPANY_REFERENCE", `The selected ${invalidReference.label} does not belong to the current company.`);
    }
    const id = db.saveKnowledgeEntry(parsed);
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.deleteKnowledgeEntry, async (_event, payload) => {
    const parsed = deleteEntitySchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("knowledge_base", parsed.id, parsed.companyId)) {
      return fail("ENTITY_NOT_FOUND", "Knowledge entry not found in the current company.");
    }
    db.deleteKnowledgeEntry(parsed.id, parsed.companyId);
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.saveSprint, async (_event, payload) => {
    const parsed = sprintInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    let previousSprintStatus: string | null = null;
    if (parsed.id) {
      try {
        previousSprintStatus = db.listSnapshot().sprints.find((s: { id: string }) => s.id === parsed.id)?.status ?? null;
      } catch {
        previousSprintStatus = null;
      }
    }
    const id = db.saveSprint(parsed);
    if (parsed.status === "active" && previousSprintStatus !== "active") {
      dispatchAutomation("sprint_started", { companyId: parsed.companyId });
    }
    if (parsed.status === "completed" && previousSprintStatus !== "completed") {
      dispatchAutomation("sprint_ended", { companyId: parsed.companyId });
    }
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.deleteSprint, async (_event, payload) => {
    const parsed = deleteEntitySchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("sprints", parsed.id, parsed.companyId)) {
      return fail("ENTITY_NOT_FOUND", "Sprint not found in the current company.");
    }
    db.deleteSprint(parsed.id, parsed.companyId);
    publishDomainChanged();
    return ok(true);
  });
}
