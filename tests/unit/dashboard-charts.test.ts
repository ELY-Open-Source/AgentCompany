import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { RunRecord, CostRecord, AgentRecord } from "../../src/shared/types";
import {
  aggregateRunsByDay,
  aggregateCostsByDay,
  aggregateAgentWorkload,
  formatShortDate,
} from "../../src/renderer/components/dashboard/charts/chart-utils";
import type {
  DailyRunData as _DailyRunData,
  DailyCostData as _DailyCostData,
  AgentWorkloadData as _AgentWorkloadData,
} from "../../src/renderer/components/dashboard/charts/chart-utils";

// Helper to create a minimal RunRecord for testing
function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "run-1",
    companyId: "co-1",
    taskId: "task-1",
    agentId: "agent-1",
    workspaceId: null,
    connectorId: "claude-pro",
    status: "succeeded",
    summary: "",
    errorMessage: null,
    exitCode: null,
    signal: null,
    model: null,
    costUsd: null,
    unattributedCost: false,
    startedAt: null,
    finishedAt: null,
    logPath: null,
    createdAt: "2026-03-20T10:00:00Z",
    updatedAt: "2026-03-20T10:00:00Z",
    ...overrides,
  };
}

// Helper to create a minimal CostRecord for testing
function makeCost(overrides: Partial<CostRecord> = {}): CostRecord {
  return {
    id: "cost-1",
    companyId: "co-1",
    runId: "run-1",
    taskId: null,
    agentId: null,
    connectorId: "claude-pro",
    amountUsd: 0.5,
    unattributed: false,
    createdAt: "2026-03-20T10:00:00Z",
    ...overrides,
  };
}

// Helper to create a minimal AgentRecord for testing
function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "agent-1",
    companyId: "co-1",
    name: "Alice",
    role: "engineer",
    title: "Software Engineer",
    roleLevel: "ic",
    department: "engineering",
    status: "active",
    reportsTo: null,
    connectorId: "claude-pro",
    workspaceId: null,
    model: null,
    capabilities: "[]",
    budgetMonthlyUsd: 100,
    spentMonthlyUsd: 0,
    metadataJson: "{}",
    heartbeatEnabled: false,
    heartbeatIntervalSec: 300,
    lastHeartbeatAt: null,
    createdAt: "2026-03-01T00:00:00Z",
    updatedAt: "2026-03-01T00:00:00Z",
    ...overrides,
  };
}

// Fix "today" to a known date so bucket generation is deterministic
const FIXED_NOW = new Date("2026-03-27T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("aggregateRunsByDay", () => {
  it("returns 14 entries all zeroed when given empty runs array", () => {
    const result = aggregateRunsByDay([], 14);
    expect(result).toHaveLength(14);
    for (const entry of result) {
      expect(entry.total).toBe(0);
      expect(entry.succeeded).toBe(0);
      expect(entry.failed).toBe(0);
    }
  });

  it("counts 3 runs on same day: 2 succeeded, 1 failed", () => {
    const runs = [
      makeRun({ id: "r1", status: "succeeded", createdAt: "2026-03-25T08:00:00Z" }),
      makeRun({ id: "r2", status: "succeeded", createdAt: "2026-03-25T15:00:00Z" }),
      makeRun({ id: "r3", status: "failed", createdAt: "2026-03-25T20:00:00Z" }),
    ];
    const result = aggregateRunsByDay(runs, 14);
    const day25 = result.find((d) => d.date === "2026-03-25");
    expect(day25).toBeDefined();
    expect(day25!.total).toBe(3);
    expect(day25!.succeeded).toBe(2);
    expect(day25!.failed).toBe(1);
  });

  it("returns dates sorted ascending (oldest first)", () => {
    const result = aggregateRunsByDay([], 14);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].date > result[i - 1].date).toBe(true);
    }
  });

  it("excludes runs outside the 14-day window", () => {
    const oldRun = makeRun({
      id: "old",
      status: "succeeded",
      createdAt: "2026-03-01T10:00:00Z", // well before 14 days ago
    });
    const result = aggregateRunsByDay([oldRun], 14);
    const total = result.reduce((sum, d) => sum + d.total, 0);
    expect(total).toBe(0);
  });

  it("counts timed_out and interrupted as failed", () => {
    const runs = [
      makeRun({ id: "r1", status: "timed_out", createdAt: "2026-03-25T10:00:00Z" }),
      makeRun({ id: "r2", status: "interrupted", createdAt: "2026-03-25T11:00:00Z" }),
    ];
    const result = aggregateRunsByDay(runs, 14);
    const day25 = result.find((d) => d.date === "2026-03-25");
    expect(day25!.total).toBe(2);
    expect(day25!.failed).toBe(2);
    expect(day25!.succeeded).toBe(0);
  });
});

describe("aggregateCostsByDay", () => {
  it("returns 14 entries all zeroed when given empty costs array", () => {
    const result = aggregateCostsByDay([], 14);
    expect(result).toHaveLength(14);
    for (const entry of result) {
      expect(entry.total).toBe(0);
    }
  });

  it("sums costs per day correctly", () => {
    const costs = [
      makeCost({ id: "c1", amountUsd: 1.5, createdAt: "2026-03-25T08:00:00Z" }),
      makeCost({ id: "c2", amountUsd: 2.25, createdAt: "2026-03-25T12:00:00Z" }),
      makeCost({ id: "c3", amountUsd: 0.75, createdAt: "2026-03-26T10:00:00Z" }),
    ];
    const result = aggregateCostsByDay(costs, 14);
    const day25 = result.find((d) => d.date === "2026-03-25");
    const day26 = result.find((d) => d.date === "2026-03-26");
    expect(day25!.total).toBeCloseTo(3.75);
    expect(day26!.total).toBeCloseTo(0.75);
  });

  it("handles null amountUsd as 0", () => {
    const costs = [
      makeCost({ id: "c1", amountUsd: null, createdAt: "2026-03-25T10:00:00Z" }),
      makeCost({ id: "c2", amountUsd: 1.0, createdAt: "2026-03-25T11:00:00Z" }),
    ];
    const result = aggregateCostsByDay(costs, 14);
    const day25 = result.find((d) => d.date === "2026-03-25");
    expect(day25!.total).toBeCloseTo(1.0);
  });
});

describe("aggregateAgentWorkload", () => {
  it("returns entries sorted by run count descending for 3 agents", () => {
    const agents = [
      makeAgent({ id: "a1", name: "Alice" }),
      makeAgent({ id: "a2", name: "Bob" }),
      makeAgent({ id: "a3", name: "Charlie" }),
    ];
    const runs = [
      makeRun({ id: "r1", agentId: "a1" }),
      makeRun({ id: "r2", agentId: "a1" }),
      makeRun({ id: "r3", agentId: "a1" }),
      makeRun({ id: "r4", agentId: "a2" }),
      makeRun({ id: "r5", agentId: "a2" }),
      makeRun({ id: "r6", agentId: "a3" }),
    ];
    const result = aggregateAgentWorkload(runs, agents);
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe("Alice");
    expect(result[0].runs).toBe(3);
    expect(result[1].name).toBe("Bob");
    expect(result[1].runs).toBe(2);
    expect(result[2].name).toBe("Charlie");
    expect(result[2].runs).toBe(1);
  });

  it("aggregates into top 8 + Others when 10 agents exist", () => {
    const agents: AgentRecord[] = [];
    const runs: RunRecord[] = [];
    for (let i = 1; i <= 10; i++) {
      agents.push(makeAgent({ id: `a${i}`, name: `Agent${i}` }));
      // Each agent gets (11 - i) runs so agent1 has most
      for (let j = 0; j < 11 - i; j++) {
        runs.push(makeRun({ id: `r${i}-${j}`, agentId: `a${i}` }));
      }
    }
    const result = aggregateAgentWorkload(runs, agents);
    expect(result).toHaveLength(9); // 8 top + Others
    expect(result[result.length - 1].name).toBe("Others");
    // Others should aggregate agent9 (2 runs) + agent10 (1 run) = 3 runs
    expect(result[result.length - 1].runs).toBe(3);
  });

  it("resolves agentId to agent name", () => {
    const agents = [makeAgent({ id: "a1", name: "DeepResearcher" })];
    const runs = [makeRun({ id: "r1", agentId: "a1" })];
    const result = aggregateAgentWorkload(runs, agents);
    expect(result[0].name).toBe("DeepResear...");
  });

  it("truncates agent names longer than 10 characters with ellipsis", () => {
    const agents = [makeAgent({ id: "a1", name: "VeryLongAgentName" })];
    const runs = [makeRun({ id: "r1", agentId: "a1" })];
    const result = aggregateAgentWorkload(runs, agents);
    expect(result[0].name).toBe("VeryLongAg...");
    expect(result[0].name.length).toBe(13); // 10 chars + "..."
  });

  it("does not truncate short names", () => {
    const agents = [makeAgent({ id: "a1", name: "ShortName" })];
    const runs = [makeRun({ id: "r1", agentId: "a1" })];
    const result = aggregateAgentWorkload(runs, agents);
    expect(result[0].name).toBe("ShortName");
  });
});

describe("formatShortDate", () => {
  it('formats "2026-03-15" as "Mar 15"', () => {
    const result = formatShortDate("2026-03-15");
    expect(result).toBe("Mar 15");
  });

  it('formats "2026-01-01" as "Jan 1"', () => {
    const result = formatShortDate("2026-01-01");
    expect(result).toBe("Jan 1");
  });

  it('formats "2026-12-25" as "Dec 25"', () => {
    const result = formatShortDate("2026-12-25");
    expect(result).toBe("Dec 25");
  });
});
