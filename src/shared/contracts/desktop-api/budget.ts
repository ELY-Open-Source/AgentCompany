import type { z } from "zod";
import type { BudgetIncidentRecord, BudgetPolicyRecord, BudgetStatusSummary } from "../../types";
import type { budgetPolicyInputSchema, deleteBudgetPolicySchema, listBudgetIncidentsSchema, resolveBudgetIncidentSchema } from "../schemas-budget";
import type { DesktopResult } from "./common";

export type BudgetApi = {
  saveBudgetPolicy: (input: z.infer<typeof budgetPolicyInputSchema>) => Promise<DesktopResult<string>>;
  deleteBudgetPolicy: (input: z.infer<typeof deleteBudgetPolicySchema>) => Promise<DesktopResult<boolean>>;
  listBudgetPolicies: (companyId: string) => Promise<DesktopResult<BudgetPolicyRecord[]>>;
  listBudgetIncidents: (input: z.infer<typeof listBudgetIncidentsSchema>) => Promise<DesktopResult<BudgetIncidentRecord[]>>;
  resolveBudgetIncident: (input: z.infer<typeof resolveBudgetIncidentSchema>) => Promise<DesktopResult<boolean>>;
  getBudgetStatus: (companyId: string) => Promise<DesktopResult<BudgetStatusSummary>>;
};
