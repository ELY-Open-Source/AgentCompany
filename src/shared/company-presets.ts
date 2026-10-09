/** What a new company starts with; the seeds use these and onboarding shows them, so the two cannot drift. */
export const COMPANY_PRESETS = {
  ceoBudgetCents: 25_000,
  /** Monthly budget of each agent an agent hires. */
  agentHireBudgetCents: 25_000,
  departmentHeadcount: 12,
  departmentBudgetCents: 2_500_000,
  /** A hire with a larger monthly budget goes to review. */
  hireReviewAboveCents: 500_000,
  providerMonthlyRequests: 1_000,
  /** Tasks riskier than this need approval. */
  taskRiskCeiling: "medium",
} as const;
