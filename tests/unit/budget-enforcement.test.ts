import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for budget policy evaluation and cost aggregation logic.
 *
 * Tests pure functions extracted from the budget enforcement service:
 * - getSpentInWindow: aggregates cost_entries by scope in cents
 * - getActivePoliciesForRun: finds matching policies for company+agent+project
 * - saveBudgetPolicy / deleteBudgetPolicy CRUD
 * - evaluateBudgetGate: returns blocked when ANY scope is exhausted (strictest-wins D-01)
 */

import type { BudgetPolicyRecord } from "../../src/shared/types";

// ---------------------------------------------------------------------------
// Helper: simulate getSpentInWindow (SUM(amount_usd) * 100 rounded to cents)
// ---------------------------------------------------------------------------
function computeSpentCents(costEntries: Array<{ amountUsd: number | null }>): number {
  const total = costEntries.reduce((sum, c) => sum + (c.amountUsd ?? 0), 0);
  return Math.round(total * 100);
}

// ---------------------------------------------------------------------------
// Helper: simulate getCalendarMonthWindow
// ---------------------------------------------------------------------------
function getCalendarMonthWindow(now: Date = new Date()): { start: string; end: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1)).toISOString();
  const end = new Date(Date.UTC(year, month + 1, 1)).toISOString();
  return { start, end };
}

// ---------------------------------------------------------------------------
// Helper: simulate evaluateBudgetGate (strictest-wins per D-01)
// ---------------------------------------------------------------------------
interface BudgetGateResult {
  allowed: boolean;
  blockedBy: Array<{
    policyId: string;
    scopeType: string;
    scopeId: string;
    spent: number;
    limit: number;
  }>;
}

function evaluateBudgetGate(
  policies: BudgetPolicyRecord[],
  getSpent: (policy: BudgetPolicyRecord) => number,
): BudgetGateResult {
  if (policies.length === 0) {
    return { allowed: true, blockedBy: [] };
  }

  const blockedBy: BudgetGateResult["blockedBy"] = [];
  for (const policy of policies) {
    if (!policy.hardStopEnabled) continue;
    const spent = getSpent(policy);
    if (spent >= policy.amount) {
      blockedBy.push({
        policyId: policy.id,
        scopeType: policy.scopeType,
        scopeId: policy.scopeId,
        spent,
        limit: policy.amount,
      });
    }
  }

  return { allowed: blockedBy.length === 0, blockedBy };
}

// ---------------------------------------------------------------------------
// Mock database for CRUD testing
// ---------------------------------------------------------------------------
function createMockDb() {
  const policies: BudgetPolicyRecord[] = [];
  const costEntries: Array<{
    companyId: string;
    agentId: string | null;
    projectId: string | null;
    amountUsd: number;
    createdAt: string;
  }> = [];

  const budget = {
    saveBudgetPolicy(input: Partial<BudgetPolicyRecord> & { companyId: string; scopeType: string; scopeId: string; amount: number }) {
      const id = input.id ?? crypto.randomUUID();
      const existing = policies.findIndex((p) => p.id === id);
      const ts = new Date().toISOString();
      const policy: BudgetPolicyRecord = {
        id,
        companyId: input.companyId,
        scopeType: input.scopeType as "company" | "agent" | "project",
        scopeId: input.scopeId,
        metric: input.metric ?? "billed_cents",
        windowKind: input.windowKind ?? "calendar_month_utc",
        amount: input.amount,
        warnPercent: input.warnPercent ?? 80,
        hardStopEnabled: input.hardStopEnabled ?? true,
        notifyEnabled: input.notifyEnabled ?? true,
        isActive: input.isActive ?? true,
        createdAt: existing >= 0 ? policies[existing]!.createdAt : ts,
        updatedAt: ts,
      };
      if (existing >= 0) {
        policies[existing] = policy;
      } else {
        policies.push(policy);
      }
      return id;
    },

    deleteBudgetPolicy(companyId: string, policyId: string) {
      const idx = policies.findIndex((p) => p.id === policyId && p.companyId === companyId);
      if (idx >= 0) policies.splice(idx, 1);
    },

    listBudgetPolicies(companyId: string) {
      return policies
        .filter((p) => p.companyId === companyId)
        .sort((a, b) => a.scopeType.localeCompare(b.scopeType) || a.createdAt.localeCompare(b.createdAt));
    },

    getActivePoliciesForRun(companyId: string, agentId: string, projectId: string | null) {
      return policies.filter(
        (p) =>
          p.companyId === companyId &&
          p.isActive &&
          ((p.scopeType === "company" && p.scopeId === companyId) ||
            (p.scopeType === "agent" && p.scopeId === agentId) ||
            (p.scopeType === "project" && projectId !== null && p.scopeId === projectId)),
      );
    },

    getSpentInWindow(policy: BudgetPolicyRecord): number {
      const window = getCalendarMonthWindow();
      let filtered = costEntries.filter(
        (c) => c.companyId === policy.companyId && c.createdAt >= window.start && c.createdAt < window.end,
      );
      if (policy.scopeType === "agent") {
        filtered = filtered.filter((c) => c.agentId === policy.scopeId);
      } else if (policy.scopeType === "project") {
        filtered = filtered.filter((c) => c.projectId === policy.scopeId);
      }
      return computeSpentCents(filtered);
    },
  };
  return { policies, costEntries, core: { budget } };
}

// ======================================================================
// Tests
// ======================================================================

describe("Budget Policy CRUD", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("saveBudgetPolicy creates new policy and returns its ID", () => {
    const id = db.core.budget.saveBudgetPolicy({
      companyId: "c1",
      scopeType: "company",
      scopeId: "c1",
      amount: 10000,
    });
    expect(id).toBeTruthy();
    expect(db.policies).toHaveLength(1);
    expect(db.policies[0]!.amount).toBe(10000);
    expect(db.policies[0]!.scopeType).toBe("company");
  });

  it("saveBudgetPolicy updates existing policy when ID provided", () => {
    const id = db.core.budget.saveBudgetPolicy({
      companyId: "c1",
      scopeType: "company",
      scopeId: "c1",
      amount: 10000,
    });
    db.core.budget.saveBudgetPolicy({
      id,
      companyId: "c1",
      scopeType: "company",
      scopeId: "c1",
      amount: 20000,
    });
    expect(db.policies).toHaveLength(1);
    expect(db.policies[0]!.amount).toBe(20000);
  });

  it("deleteBudgetPolicy removes policy by ID", () => {
    const id = db.core.budget.saveBudgetPolicy({
      companyId: "c1",
      scopeType: "company",
      scopeId: "c1",
      amount: 10000,
    });
    expect(db.policies).toHaveLength(1);
    db.core.budget.deleteBudgetPolicy("c1", id);
    expect(db.policies).toHaveLength(0);
  });
});

describe("getActivePoliciesForRun", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("returns all active policies matching company+agent+project scopes", () => {
    db.core.budget.saveBudgetPolicy({ companyId: "c1", scopeType: "company", scopeId: "c1", amount: 50000 });
    db.core.budget.saveBudgetPolicy({ companyId: "c1", scopeType: "agent", scopeId: "a1", amount: 10000 });
    db.core.budget.saveBudgetPolicy({ companyId: "c1", scopeType: "project", scopeId: "p1", amount: 20000 });
    // Different company — should not match
    db.core.budget.saveBudgetPolicy({ companyId: "c2", scopeType: "company", scopeId: "c2", amount: 99999 });

    const result = db.core.budget.getActivePoliciesForRun("c1", "a1", "p1");
    expect(result).toHaveLength(3);
    expect(result.map((p) => p.scopeType).sort()).toEqual(["agent", "company", "project"]);
  });

  it("returns empty array when no policies exist (D-02: no policy = unlimited)", () => {
    const result = db.core.budget.getActivePoliciesForRun("c1", "a1", null);
    expect(result).toEqual([]);
  });

  it("excludes project scope when projectId is null", () => {
    db.core.budget.saveBudgetPolicy({ companyId: "c1", scopeType: "company", scopeId: "c1", amount: 50000 });
    db.core.budget.saveBudgetPolicy({ companyId: "c1", scopeType: "project", scopeId: "p1", amount: 20000 });

    const result = db.core.budget.getActivePoliciesForRun("c1", "a1", null);
    expect(result).toHaveLength(1);
    expect(result[0]!.scopeType).toBe("company");
  });
});

describe("getSpentInWindow", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("returns SUM(amount_usd)*100 rounded to integer cents for company scope", () => {
    const now = new Date();
    db.costEntries.push(
      { companyId: "c1", agentId: "a1", projectId: null, amountUsd: 1.50, createdAt: now.toISOString() },
      { companyId: "c1", agentId: "a2", projectId: null, amountUsd: 2.30, createdAt: now.toISOString() },
    );

    const policy: BudgetPolicyRecord = {
      id: "pol1", companyId: "c1", scopeType: "company", scopeId: "c1",
      metric: "billed_cents", windowKind: "calendar_month_utc",
      amount: 100000, warnPercent: 80, hardStopEnabled: true, notifyEnabled: true,
      isActive: true, createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };
    const spent = db.core.budget.getSpentInWindow(policy);
    expect(spent).toBe(380); // (1.50 + 2.30) * 100 = 380 cents
  });

  it("filters by agent_id for agent scope", () => {
    const now = new Date();
    db.costEntries.push(
      { companyId: "c1", agentId: "a1", projectId: null, amountUsd: 5.00, createdAt: now.toISOString() },
      { companyId: "c1", agentId: "a2", projectId: null, amountUsd: 3.00, createdAt: now.toISOString() },
    );

    const policy: BudgetPolicyRecord = {
      id: "pol1", companyId: "c1", scopeType: "agent", scopeId: "a1",
      metric: "billed_cents", windowKind: "calendar_month_utc",
      amount: 100000, warnPercent: 80, hardStopEnabled: true, notifyEnabled: true,
      isActive: true, createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };
    const spent = db.core.budget.getSpentInWindow(policy);
    expect(spent).toBe(500); // Only a1's $5.00 = 500 cents
  });

  it("filters by project_id for project scope", () => {
    const now = new Date();
    db.costEntries.push(
      { companyId: "c1", agentId: "a1", projectId: "p1", amountUsd: 7.50, createdAt: now.toISOString() },
      { companyId: "c1", agentId: "a1", projectId: "p2", amountUsd: 2.00, createdAt: now.toISOString() },
    );

    const policy: BudgetPolicyRecord = {
      id: "pol1", companyId: "c1", scopeType: "project", scopeId: "p1",
      metric: "billed_cents", windowKind: "calendar_month_utc",
      amount: 100000, warnPercent: 80, hardStopEnabled: true, notifyEnabled: true,
      isActive: true, createdAt: now.toISOString(), updatedAt: now.toISOString(),
    };
    const spent = db.core.budget.getSpentInWindow(policy);
    expect(spent).toBe(750); // Only p1's $7.50 = 750 cents
  });
});

describe("evaluateBudgetGate", () => {
  it("returns allowed:true with empty blockedBy when no policies exist (D-02)", () => {
    const result = evaluateBudgetGate([], vi.fn());
    expect(result).toEqual({ allowed: true, blockedBy: [] });
  });

  it("returns allowed:true when no policies are exhausted", () => {
    const policy: BudgetPolicyRecord = {
      id: "pol1", companyId: "c1", scopeType: "company", scopeId: "c1",
      metric: "billed_cents", windowKind: "calendar_month_utc",
      amount: 10000, warnPercent: 80, hardStopEnabled: true, notifyEnabled: true,
      isActive: true, createdAt: "", updatedAt: "",
    };
    const getSpent = vi.fn().mockReturnValue(5000); // 50% spent

    const result = evaluateBudgetGate([policy], getSpent);
    expect(result.allowed).toBe(true);
    expect(result.blockedBy).toHaveLength(0);
  });

  it("returns blocked when ANY scope is exhausted (strictest-wins D-01)", () => {
    const companyPolicy: BudgetPolicyRecord = {
      id: "pol1", companyId: "c1", scopeType: "company", scopeId: "c1",
      metric: "billed_cents", windowKind: "calendar_month_utc",
      amount: 100000, warnPercent: 80, hardStopEnabled: true, notifyEnabled: true,
      isActive: true, createdAt: "", updatedAt: "",
    };
    const agentPolicy: BudgetPolicyRecord = {
      id: "pol2", companyId: "c1", scopeType: "agent", scopeId: "a1",
      metric: "billed_cents", windowKind: "calendar_month_utc",
      amount: 5000, warnPercent: 80, hardStopEnabled: true, notifyEnabled: true,
      isActive: true, createdAt: "", updatedAt: "",
    };

    const getSpent = vi.fn((policy: BudgetPolicyRecord) => {
      if (policy.scopeType === "company") return 50000; // 50% of company
      return 5500; // 110% of agent
    });

    const result = evaluateBudgetGate([companyPolicy, agentPolicy], getSpent);
    expect(result.allowed).toBe(false);
    expect(result.blockedBy).toHaveLength(1);
    expect(result.blockedBy[0]!.policyId).toBe("pol2");
    expect(result.blockedBy[0]!.scopeType).toBe("agent");
  });

  it("skips policies where hardStopEnabled is false", () => {
    const policy: BudgetPolicyRecord = {
      id: "pol1", companyId: "c1", scopeType: "company", scopeId: "c1",
      metric: "billed_cents", windowKind: "calendar_month_utc",
      amount: 1000, warnPercent: 80, hardStopEnabled: false, notifyEnabled: true,
      isActive: true, createdAt: "", updatedAt: "",
    };
    const getSpent = vi.fn().mockReturnValue(5000); // Way over limit

    const result = evaluateBudgetGate([policy], getSpent);
    expect(result.allowed).toBe(true);
    expect(result.blockedBy).toHaveLength(0);
  });
});

describe("getCalendarMonthWindow", () => {
  it("returns start of current month and start of next month in UTC", () => {
    const testDate = new Date("2026-03-15T10:30:00Z");
    const window = getCalendarMonthWindow(testDate);
    expect(window.start).toBe("2026-03-01T00:00:00.000Z");
    expect(window.end).toBe("2026-04-01T00:00:00.000Z");
  });

  it("handles December rollover to January next year", () => {
    const testDate = new Date("2026-12-25T10:30:00Z");
    const window = getCalendarMonthWindow(testDate);
    expect(window.start).toBe("2026-12-01T00:00:00.000Z");
    expect(window.end).toBe("2027-01-01T00:00:00.000Z");
  });
});
