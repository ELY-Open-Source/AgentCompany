import type { BudgetPolicyRecord } from "@shared/types";

interface BuildBudgetPolicyInputArgs {
  policyId?: string | null;
  companyId: string;
  scopeType: "company" | "agent" | "project";
  scopeId: string;
  amountDollars: string;
  warnPercent: string;
  hardStopEnabled: boolean;
  notifyEnabled: boolean;
}

export function buildBudgetPolicyInput(args: BuildBudgetPolicyInputArgs) {
  const amount = Math.round(Number.parseFloat(args.amountDollars) * 100);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const warnPercent = Number.parseInt(args.warnPercent, 10);
  if (!Number.isFinite(warnPercent) || warnPercent < 1 || warnPercent > 100) {
    return null;
  }

  return {
    id: args.policyId ?? null,
    companyId: args.companyId,
    scopeType: args.scopeType,
    scopeId: args.scopeId,
    metric: "billed_cents" as const,
    windowKind: "calendar_month_utc" as const,
    amount,
    warnPercent,
    hardStopEnabled: args.hardStopEnabled,
    notifyEnabled: args.notifyEnabled,
    isActive: true,
  };
}

export function getBudgetPolicyAmountDollars(policy: BudgetPolicyRecord | null): string {
  if (!policy) {
    return "";
  }
  return (policy.amount / 100).toFixed(2);
}
