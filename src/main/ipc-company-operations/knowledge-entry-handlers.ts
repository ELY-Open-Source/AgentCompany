import { IPC_CHANNELS, deleteEntitySchema, knowledgeEntryInputSchema } from "@shared/contracts";
import { fail, ok } from "../ipc-domain-common";
import { COMPANY_SCOPED_REFERENCE_TABLES } from "./reference-tables";
import type { CompanyOperationHandlerDependencies } from "./types";

export function registerKnowledgeEntryHandlers({
  registerHandle,
  db,
  ensureCompanyExists,
  findInvalidReference,
  publishDomainChanged,
}: CompanyOperationHandlerDependencies) {
  registerHandle(IPC_CHANNELS.saveKnowledgeEntry, async (_event, payload) => {
    const parsed = knowledgeEntryInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;

    const knowledgeReferences = [
      { id: parsed.authorAgentId, table: "agents", label: "knowledge author" },
      ...(parsed.referencedEntityId && parsed.referencedEntityType && COMPANY_SCOPED_REFERENCE_TABLES.has(parsed.referencedEntityType)
        ? [{ id: parsed.referencedEntityId, table: parsed.referencedEntityType, label: "referenced entity" }]
        : []),
    ];
    const invalidReference = findInvalidReference(parsed.companyId, [
      ...knowledgeReferences,
    ]);
    if (invalidReference) {
      return fail("INVALID_COMPANY_REFERENCE", `The selected ${invalidReference.label} does not belong to the current company.`);
    }

    const id = db.core.knowledge.saveKnowledgeEntry(parsed);
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.deleteKnowledgeEntry, async (_event, payload) => {
    const parsed = deleteEntitySchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.core.settings.belongsToCompany("knowledge_base", parsed.id, parsed.companyId)) {
      return fail("ENTITY_NOT_FOUND", "Knowledge entry not found in the current company.");
    }
    db.core.knowledge.deleteKnowledgeEntry(parsed.id, parsed.companyId);
    publishDomainChanged();
    return ok(true);
  });
}
