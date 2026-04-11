import { describe, expect, it } from "vitest";
import { buildBudgetPolicyInput, getBudgetPolicyAmountDollars } from "../../src/renderer/lib/budget-policy-input";

describe("budget-policy-input", () => {
  it("preserves the existing policy id on edit", () => {
    const payload = buildBudgetPolicyInput({
      policyId: "policy-123",
      companyId: "00000000-0000-0000-0000-000000000001",
      scopeType: "agent",
      scopeId: "00000000-0000-0000-0000-000000000002",
      amountDollars: "250.00",
      warnPercent: "85",
      hardStopEnabled: true,
      notifyEnabled: true,
    });

    expect(payload?.id).toBe("policy-123");
    expect(payload?.amount).toBe(25000);
    expect(payload?.warnPercent).toBe(85);
  });

  it("formats stored cents back to dollars for edit forms", () => {
    expect(
      getBudgetPolicyAmountDollars({
        id: "policy-123",
        companyId: "company-1",
        scopeType: "agent",
        scopeId: "agent-1",
        metric: "billed_cents",
        windowKind: "calendar_month_utc",
        amount: 12550,
        warnPercent: 80,
        hardStopEnabled: true,
        notifyEnabled: true,
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe("125.50");
  });
});
