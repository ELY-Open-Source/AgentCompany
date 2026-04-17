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

/**
 * Convert a dollar-string ("12.34") to integer cents without relying on float
 * multiplication (which can lose precision, e.g. 0.29 * 100 = 28.9999...).
 * Accepts optional sign, digits, and up to two fractional digits.
 */
function dollarsToCents(input: string): number | null {
  const trimmed = input.trim();
  const match = /^-?(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;
  const whole = match[1];
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const cents = Number.parseInt(whole + fraction, 10);
  if (!Number.isFinite(cents)) return null;
  return trimmed.startsWith("-") ? -cents : cents;
}

export function buildBudgetPolicyInput(args: BuildBudgetPolicyInputArgs) {
  const amount = dollarsToCents(args.amountDollars);
  if (amount === null || amount <= 0) {
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
