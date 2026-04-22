import {
  IPC_CHANNELS,
  budgetPolicyInputSchema,
  listBudgetPoliciesSchema,
  deleteBudgetPolicySchema,
  listBudgetIncidentsSchema,
  resolveBudgetIncidentSchema,
  getBudgetStatusSchema,
} from "@shared/contracts";
import { fail, ok, type RegisterDomainHandlersDependencies } from "./ipc-domain-common";
import type { createBudgetEnforcementService } from "./budget-enforcement-service";
import type { AppDatabase } from "./database";

interface BudgetHandlerDependencies extends Pick<
  RegisterDomainHandlersDependencies,
  "registerHandle" | "ensureCompanyExists" | "publishDomainChanged" | "logger"
> {
  budgetService: ReturnType<typeof createBudgetEnforcementService> | null;
  db: AppDatabase;
}

export function registerBudgetHandlers({
  registerHandle,
  ensureCompanyExists,
  publishDomainChanged,
  budgetService,
  db,
  logger,
}: BudgetHandlerDependencies) {
  // ---- Save (create/update) a budget policy ----
  registerHandle(IPC_CHANNELS.saveBudgetPolicy, async (_event, payload) => {
    const parsed = budgetPolicyInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const id = db.core.budget.saveBudgetPolicy(parsed);
    // D-06: Auto-resolve incidents if limit was increased above current spend
    if (budgetService) {
      try {
        budgetService.checkAutoResolve(parsed.companyId, id);
      } catch (err) {
        logger.warn(`[ipc/budget] checkAutoResolve failed for policy ${id} in company ${parsed.companyId}:`, err instanceof Error ? err.message : String(err));
      }
    }
    publishDomainChanged();
    return ok(id);
  });

  // ---- Delete a budget policy ----
  registerHandle(IPC_CHANNELS.deleteBudgetPolicy, async (_event, payload) => {
    const parsed = deleteBudgetPolicySchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    db.core.budget.deleteBudgetPolicy(parsed.companyId, parsed.policyId);
    publishDomainChanged();
    return ok(true);
  });

  // ---- List all budget policies for a company ----
  registerHandle(IPC_CHANNELS.listBudgetPolicies, async (_event, payload) => {
    const parsed = listBudgetPoliciesSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    return ok(db.core.budget.listBudgetPolicies(parsed.companyId));
  });

  // ---- List budget incidents ----
  registerHandle(IPC_CHANNELS.listBudgetIncidents, async (_event, payload) => {
    const parsed = listBudgetIncidentsSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    return ok(db.core.budget.listBudgetIncidents(parsed.companyId, parsed.status));
  });

  // ---- Resolve a budget incident manually ----
  registerHandle(IPC_CHANNELS.resolveBudgetIncident, async (_event, payload) => {
    const parsed = resolveBudgetIncidentSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    db.core.budget.resolveBudgetIncident(parsed.incidentId, parsed.companyId);
    publishDomainChanged();
    return ok(true);
  });

  // ---- Get budget status summary ----
  registerHandle(IPC_CHANNELS.getBudgetStatus, async (_event, payload) => {
    const parsed = getBudgetStatusSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!budgetService) {
      return fail("SERVICE_NOT_READY", "Budget enforcement service is not initialized.");
    }
    return ok(budgetService.getBudgetStatus(parsed.companyId));
  });
}
