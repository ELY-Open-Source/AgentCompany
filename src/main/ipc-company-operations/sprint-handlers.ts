import { IPC_CHANNELS, deleteEntitySchema, sprintInputSchema } from "@shared/contracts";
import { fail, ok } from "../ipc-domain-common";
import type { CompanyOperationHandlerDependencies } from "./types";

export function registerSprintHandlers({
  registerHandle,
  db,
  ensureCompanyExists,
  publishDomainChanged,
  dispatchAutomation,
  logger,
}: CompanyOperationHandlerDependencies) {
  registerHandle(IPC_CHANNELS.saveSprint, async (_event, payload) => {
    const parsed = sprintInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (parsed.id && !db.core.settings.belongsToCompany("sprints", parsed.id, parsed.companyId)) {
      return fail("ENTITY_NOT_FOUND", "Sprint not found in the current company.");
    }

    let previousSprintStatus: string | null = null;
    if (parsed.id) {
      try {
        previousSprintStatus = db.projection.snapshot.listSnapshot().sprints.find((s: { id: string }) => s.id === parsed.id)?.status ?? null;
      } catch (err) {
        logger.warn(`[ipc/sprints] listSnapshot failed while resolving sprint ${parsed.id} previous status:`, err instanceof Error ? err.message : String(err));
        previousSprintStatus = null;
      }
    }

    const id = db.core.knowledge.saveSprint(parsed);
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
    if (!db.core.settings.belongsToCompany("sprints", parsed.id, parsed.companyId)) {
      return fail("ENTITY_NOT_FOUND", "Sprint not found in the current company.");
    }
    db.core.knowledge.deleteSprint(parsed.id, parsed.companyId);
    publishDomainChanged();
    return ok(true);
  });
}
