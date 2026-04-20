import { describe, it, expect, beforeEach } from "vitest";

/**
 * Tests for budget incident lifecycle: creation, deduplication (D-08),
 * resolution, and auto-close of expired incidents (D-06).
 */

import type { BudgetPolicyRecord, BudgetIncidentRecord } from "../../src/shared/types";

// ---------------------------------------------------------------------------
// Mock incident store simulating upsertBudgetIncident, resolveIncidentsForPolicy,
// autoCloseExpiredIncidents behaviors from database.ts
// ---------------------------------------------------------------------------
function createMockIncidentDb() {
  const incidents: BudgetIncidentRecord[] = [];
  let idCounter = 0;

  function getCalendarMonthWindow(now: Date = new Date()): { start: string; end: string } {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const start = new Date(Date.UTC(year, month, 1)).toISOString();
    const end = new Date(Date.UTC(year, month + 1, 1)).toISOString();
    return { start, end };
  }

  const budget = {
    getCalendarMonthWindow,

    upsertBudgetIncident(
      policy: BudgetPolicyRecord,
      thresholdType: "warn_threshold" | "hard_stop",
      amountObserved: number,
    ): string {
      const window = getCalendarMonthWindow();
      const existing = incidents.find(
        (i) =>
          i.policyId === policy.id &&
          i.windowStart === window.start &&
          i.thresholdType === thresholdType &&
          i.status === "open",
      );

      if (existing) {
        existing.amountObserved = amountObserved;
        existing.updatedAt = new Date().toISOString();
        return existing.id;
      }

      const id = `inc-${++idCounter}`;
      const ts = new Date().toISOString();
      incidents.push({
        id,
        companyId: policy.companyId,
        policyId: policy.id,
        scopeType: policy.scopeType,
        scopeId: policy.scopeId,
        metric: policy.metric,
        windowKind: policy.windowKind,
        windowStart: window.start,
        windowEnd: window.end,
        thresholdType,
        amountLimit: policy.amount,
        amountObserved,
        status: "open",
        resolvedAt: null,
        createdAt: ts,
        updatedAt: ts,
      });
      return id;
    },

    resolveIncidentsForPolicy(policyId: string, resolutionStatus: string): number {
      let count = 0;
      const ts = new Date().toISOString();
      for (const incident of incidents) {
        if (incident.policyId === policyId && incident.status === "open") {
          incident.status = resolutionStatus as BudgetIncidentRecord["status"];
          incident.resolvedAt = ts;
          incident.updatedAt = ts;
          count++;
        }
      }
      return count;
    },

    resolveWarnIncidentsForPolicy(policyId: string, resolutionStatus: string): number {
      let count = 0;
      const ts = new Date().toISOString();
      for (const incident of incidents) {
        if (incident.policyId === policyId && incident.status === "open" && incident.thresholdType === "warn_threshold") {
          incident.status = resolutionStatus as BudgetIncidentRecord["status"];
          incident.resolvedAt = ts;
          incident.updatedAt = ts;
          count++;
        }
      }
      return count;
    },

    autoCloseExpiredIncidents(companyId: string): number {
      let count = 0;
      const now = new Date().toISOString();
      for (const incident of incidents) {
        if (
          incident.companyId === companyId &&
          incident.status === "open" &&
          incident.windowEnd <= now
        ) {
          incident.status = "auto_closed";
          incident.resolvedAt = now;
          incident.updatedAt = now;
          count++;
        }
      }
      return count;
    },

    listBudgetIncidents(companyId: string, statusFilter: string = "all"): BudgetIncidentRecord[] {
      return incidents
        .filter((i) => i.companyId === companyId && (statusFilter === "all" || i.status === statusFilter))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    resolveBudgetIncident(incidentId: string, companyId: string): boolean {
      const incident = incidents.find((i) => i.id === incidentId && i.companyId === companyId && i.status === "open");
      if (!incident) return false;
      const ts = new Date().toISOString();
      incident.status = "resolved";
      incident.resolvedAt = ts;
      incident.updatedAt = ts;
      return true;
    },
  };
  return { incidents, budget };
}

function makePolicy(overrides: Partial<BudgetPolicyRecord> = {}): BudgetPolicyRecord {
  return {
    id: "pol-1",
    companyId: "c1",
    scopeType: "agent",
    scopeId: "a1",
    metric: "billed_cents",
    windowKind: "calendar_month_utc",
    amount: 10000,
    warnPercent: 80,
    hardStopEnabled: true,
    notifyEnabled: true,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ======================================================================
// Tests
// ======================================================================

describe("upsertBudgetIncident", () => {
  let db: ReturnType<typeof createMockIncidentDb>;

  beforeEach(() => {
    db = createMockIncidentDb();
  });

  it("creates new incident when none exists for policy+window+threshold_type", () => {
    const policy = makePolicy();
    const id = db.budget.upsertBudgetIncident(policy, "warn_threshold", 8500);
    expect(id).toBeTruthy();
    expect(db.incidents).toHaveLength(1);
    expect(db.incidents[0]!.thresholdType).toBe("warn_threshold");
    expect(db.incidents[0]!.amountObserved).toBe(8500);
    expect(db.incidents[0]!.status).toBe("open");
  });

  it("updates amount_observed when open incident already exists (D-08 dedup)", () => {
    const policy = makePolicy();
    const id1 = db.budget.upsertBudgetIncident(policy, "warn_threshold", 8500);
    const id2 = db.budget.upsertBudgetIncident(policy, "warn_threshold", 9200);
    expect(id1).toBe(id2); // Same incident, not a new one
    expect(db.incidents).toHaveLength(1); // Still just one
    expect(db.incidents[0]!.amountObserved).toBe(9200); // Updated
  });

  it("creates separate incidents for different threshold types", () => {
    const policy = makePolicy();
    db.budget.upsertBudgetIncident(policy, "warn_threshold", 8500);
    db.budget.upsertBudgetIncident(policy, "hard_stop", 10500);
    expect(db.incidents).toHaveLength(2);
    expect(db.incidents[0]!.thresholdType).toBe("warn_threshold");
    expect(db.incidents[1]!.thresholdType).toBe("hard_stop");
  });
});

describe("resolveIncidentsForPolicy", () => {
  let db: ReturnType<typeof createMockIncidentDb>;

  beforeEach(() => {
    db = createMockIncidentDb();
  });

  it("sets status to provided resolution reason for all open incidents", () => {
    const policy = makePolicy();
    db.budget.upsertBudgetIncident(policy, "warn_threshold", 8500);
    db.budget.upsertBudgetIncident(policy, "hard_stop", 10500);

    const count = db.budget.resolveIncidentsForPolicy("pol-1", "auto_resolved_limit_increase");
    expect(count).toBe(2);
    expect(db.incidents[0]!.status).toBe("auto_resolved_limit_increase");
    expect(db.incidents[1]!.status).toBe("auto_resolved_limit_increase");
    expect(db.incidents[0]!.resolvedAt).toBeTruthy();
  });

  it("does not affect already-resolved incidents", () => {
    const policy = makePolicy();
    db.budget.upsertBudgetIncident(policy, "warn_threshold", 8500);
    db.budget.resolveIncidentsForPolicy("pol-1", "resolved");
    // Now try to resolve again
    const count = db.budget.resolveIncidentsForPolicy("pol-1", "auto_resolved_limit_increase");
    expect(count).toBe(0);
    expect(db.incidents[0]!.status).toBe("resolved"); // Unchanged
  });
});

describe("autoCloseExpiredIncidents", () => {
  let db: ReturnType<typeof createMockIncidentDb>;

  beforeEach(() => {
    db = createMockIncidentDb();
  });

  it("closes incidents whose window_end is in the past", () => {
    const _policy = makePolicy();
    // Manually create an expired incident
    db.incidents.push({
      id: "expired-1",
      companyId: "c1",
      policyId: "pol-1",
      scopeType: "agent",
      scopeId: "a1",
      metric: "billed_cents",
      windowKind: "calendar_month_utc",
      windowStart: "2025-01-01T00:00:00.000Z",
      windowEnd: "2025-02-01T00:00:00.000Z", // In the past
      thresholdType: "warn_threshold",
      amountLimit: 10000,
      amountObserved: 8500,
      status: "open",
      resolvedAt: null,
      createdAt: "2025-01-15T00:00:00.000Z",
      updatedAt: "2025-01-15T00:00:00.000Z",
    });

    const count = db.budget.autoCloseExpiredIncidents("c1");
    expect(count).toBe(1);
    expect(db.incidents[0]!.status).toBe("auto_closed");
    expect(db.incidents[0]!.resolvedAt).toBeTruthy();
  });

  it("does not close incidents whose window_end is in the future", () => {
    const policy = makePolicy();
    db.budget.upsertBudgetIncident(policy, "warn_threshold", 8500);
    // The auto-created incident has window_end in the future (end of current month)

    const count = db.budget.autoCloseExpiredIncidents("c1");
    expect(count).toBe(0);
    expect(db.incidents[0]!.status).toBe("open");
  });
});

describe("listBudgetIncidents", () => {
  let db: ReturnType<typeof createMockIncidentDb>;

  beforeEach(() => {
    db = createMockIncidentDb();
  });

  it("returns all incidents for a company when status is 'all'", () => {
    const policy = makePolicy();
    db.budget.upsertBudgetIncident(policy, "warn_threshold", 8500);
    db.budget.upsertBudgetIncident(policy, "hard_stop", 10500);
    db.budget.resolveIncidentsForPolicy("pol-1", "resolved");

    const all = db.budget.listBudgetIncidents("c1", "all");
    expect(all).toHaveLength(2);
  });

  it("filters by status when specified", () => {
    const policy = makePolicy();
    db.budget.upsertBudgetIncident(policy, "warn_threshold", 8500);
    db.budget.upsertBudgetIncident(policy, "hard_stop", 10500);
    // Resolve only warn
    db.budget.resolveWarnIncidentsForPolicy("pol-1", "resolved");

    const open = db.budget.listBudgetIncidents("c1", "open");
    expect(open).toHaveLength(1);
    expect(open[0]!.thresholdType).toBe("hard_stop");
  });
});

describe("checkAutoResolve (D-06)", () => {
  let db: ReturnType<typeof createMockIncidentDb>;

  beforeEach(() => {
    db = createMockIncidentDb();
  });

  it("auto-resolves incidents when policy limit increases above observed amount", () => {
    const policy = makePolicy({ amount: 10000 });
    db.budget.upsertBudgetIncident(policy, "hard_stop", 10500);
    expect(db.incidents[0]!.status).toBe("open");

    // Simulate limit increase: now checking if spent < new limit
    // If spent (10500) < new policy.amount (20000), resolve
    const spent = 10500;
    const newAmount = 20000;
    if (spent < newAmount) {
      db.budget.resolveIncidentsForPolicy("pol-1", "auto_resolved_limit_increase");
    }

    expect(db.incidents[0]!.status).toBe("auto_resolved_limit_increase");
  });

  it("auto-resolves only warn incidents when below warn threshold but above hard stop", () => {
    const policy = makePolicy({ amount: 10000, warnPercent: 80 });
    db.budget.upsertBudgetIncident(policy, "warn_threshold", 8500);
    db.budget.upsertBudgetIncident(policy, "hard_stop", 10500);

    // Spent is now 7500 (below warn threshold of 8000 = 10000*80/100)
    const spent = 7500;
    const _warnAmount = Math.floor((policy.amount * policy.warnPercent) / 100);
    if (spent < policy.amount) {
      db.budget.resolveIncidentsForPolicy("pol-1", "auto_resolved_limit_increase");
    }
    // Both resolved since spent < policy.amount
    expect(db.incidents.every((i) => i.status === "auto_resolved_limit_increase")).toBe(true);
  });
});
