import { IPC_CHANNELS, deleteEntitySchema, documentInputSchema } from "@shared/contracts";
import { createDocumentWithLifecycle } from "../document-lifecycle";
import { fail, ok } from "../ipc-domain-common";
import type { CompanyOperationHandlerDependencies } from "./types";

export function registerDocumentHandlers({
  registerHandle,
  db,
  ensureCompanyExists,
  findInvalidReference,
  publishDomainChanged,
  threadIntegration,
  checkpointEngine,
  lifecycleProcessor,
  logger,
}: CompanyOperationHandlerDependencies) {
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

    const outcome = createDocumentWithLifecycle(
      {
        db,
        threadIntegration,
        checkpointEngine,
        lifecycleProcessor,
        publishDomainChanged,
        logger,
      },
      {
        id: parsed.id ?? null,
        companyId: parsed.companyId,
        type: parsed.type,
        title: parsed.title,
        content: parsed.content ?? "",
        authorAgentId: parsed.authorAgentId ?? null,
        reviewerAgentId: parsed.reviewerAgentId ?? null,
        projectId: parsed.projectId ?? null,
        goalId: parsed.goalId ?? null,
        parentDocId: parsed.parentDocId ?? null,
        version: parsed.version ?? 1,
        status: parsed.status ?? "draft",
        tagsJson: parsed.tagsJson ?? "[]",
        sourceRunId: null,
      },
    );
    return ok(outcome.id);
  });

  registerHandle(IPC_CHANNELS.deleteDocument, async (_event, payload) => {
    const parsed = deleteEntitySchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.core.settings.belongsToCompany("documents", parsed.id, parsed.companyId)) {
      return fail("ENTITY_NOT_FOUND", "Document not found in the current company.");
    }
    db.core.documents.deleteDocument(parsed.id, parsed.companyId);
    publishDomainChanged();
    return ok(true);
  });
}
