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
  "registerHandle" | "ensureCompanyExists" | "publishDomainChanged"
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
}: BudgetHandlerDependencies) {
  function requireBudgetService() {
    if (!budgetService) {
      return fail("SERVICE_NOT_READY", "Budget enforcement service is not initialized.");
    }
    return null;
  }

  // ---- Save (create/update) a budget policy ----
  registerHandle(IPC_CHANNELS.saveBudgetPolicy, async (_event, payload) => {
    const parsed = budgetPolicyInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const id = db.saveBudgetPolicy(parsed);
    // D-06: Auto-resolve incidents if limit was increased above current spend
    if (budgetService) {
      try {
        budgetService.checkAutoResolve(parsed.companyId, id);
      } catch {
        // Best effort -- service may not be ready
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
    db.deleteBudgetPolicy(parsed.companyId, parsed.policyId);
    publishDomainChanged();
    return ok(true);
  });

  // ---- List all budget policies for a company ----
  registerHandle(IPC_CHANNELS.listBudgetPolicies, async (_event, payload) => {
    const parsed = listBudgetPoliciesSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    return ok(db.listBudgetPolicies(parsed.companyId));
  });

  // ---- List budget incidents ----
  registerHandle(IPC_CHANNELS.listBudgetIncidents, async (_event, payload) => {
    const parsed = listBudgetIncidentsSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    return ok(db.listBudgetIncidents(parsed.companyId, parsed.status));
  });

  // ---- Resolve a budget incident manually ----
  registerHandle(IPC_CHANNELS.resolveBudgetIncident, async (_event, payload) => {
    const parsed = resolveBudgetIncidentSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    db.resolveBudgetIncident(parsed.incidentId, parsed.companyId);
    publishDomainChanged();
    return ok(true);
  });

  // ---- Get budget status summary ----
  registerHandle(IPC_CHANNELS.getBudgetStatus, async (_event, payload) => {
    const parsed = getBudgetStatusSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const serviceError = requireBudgetService();
    if (serviceError) return serviceError;
    return ok(budgetService!.getBudgetStatus(parsed.companyId));
  });
}
