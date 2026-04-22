import { describe, expect, it, vi } from "vitest";
import type { AppDatabase } from "@main/database";
import { resolveInternalToolsForAgent } from "@main/orchestration/internal-tool-selector";
import type { AgentRecord } from "@shared/types";

function makeAgent(overrides: Partial<AgentRecord>): AgentRecord {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "Agent",
    role: "Engineer",
    title: "Engineer",
    roleLevel: "ic",
    department: "engineering",
    status: "idle",
    reportsTo: "ceo-1",
    connectorId: "openai-codex",
    workspaceId: null,
    model: null,
    capabilities: "",
    budgetMonthlyUsd: 100,
    spentMonthlyUsd: 0,
    metadataJson: "{}",
    heartbeatEnabled: true,
    heartbeatIntervalSec: 120,
    lastHeartbeatAt: null,
    createdAt: "2026-04-22T00:00:00.000Z",
    updatedAt: "2026-04-22T00:00:00.000Z",
    ...overrides,
  };
}

function makeDb(
  agent: AgentRecord,
  reports: AgentRecord[],
  approvals: Record<string, Array<{ id: string; state: string }>> = {},
): AppDatabase {
  return {
    entityCrud: {
      getAgent: vi.fn((agentId: string) => {
        const found = [agent, ...reports].find((candidate) => candidate.id === agentId);
        if (!found) throw new Error(`Agent not found: ${agentId}`);
        return found;
      }),
    },
    agents: {
      hasAgentPermission: vi.fn(() => false),
      getDirectReports: vi.fn(() => reports),
      getChainOfCommand: vi.fn(() => []),
    },
    approvalsMod: {
      listCompanyApprovalsByType: vi.fn((_companyId: string, type: string) => approvals[type] ?? []),
    },
  } as unknown as AppDatabase;
}

describe("resolveInternalToolsForAgent", () => {
  it("exposes only hire_agent during initial CEO team building", () => {
    const ceo = makeAgent({
      id: "ceo-1",
      role: "CEO",
      title: "CEO",
      roleLevel: "c_suite",
      department: "executive",
      reportsTo: null,
    });
    const db = makeDb(ceo, []);

    expect(resolveInternalToolsForAgent(db, ceo)).toEqual(["hire_agent"]);
  });

  it("exposes file_approval after a hire is in flight", () => {
    const ceo = makeAgent({
      id: "ceo-1",
      role: "CEO",
      title: "CEO",
      roleLevel: "c_suite",
      department: "executive",
      reportsTo: null,
    });
    const pendingHire = makeAgent({
      id: "pending-cto",
      role: "CTO",
      title: "CTO",
      reportsTo: ceo.id,
      status: "pending_approval",
    });
    const db = makeDb(ceo, [pendingHire], {
      hire_agent: [{ id: "approval-1", state: "pending" }],
    });

    expect(resolveInternalToolsForAgent(db, ceo)).toEqual(["hire_agent", "file_approval"]);
  });

  it("exposes file_approval when the CEO is operating with active reports", () => {
    const ceo = makeAgent({
      id: "ceo-1",
      role: "CEO",
      title: "CEO",
      roleLevel: "c_suite",
      department: "executive",
      reportsTo: null,
    });
    const cto = makeAgent({
      id: "cto-1",
      role: "CTO",
      title: "CTO",
      reportsTo: ceo.id,
      status: "idle",
    });
    const db = makeDb(ceo, [cto]);

    expect(resolveInternalToolsForAgent(db, ceo)).toEqual(["hire_agent", "file_approval"]);
  });

  it("keeps CEO strategy approval scoped to CEO agents", () => {
    const manager = makeAgent({
      id: "manager-1",
      role: "VP Engineering",
      title: "VP Engineering",
      roleLevel: "vp",
      reportsTo: "ceo-1",
    });
    const ic = makeAgent({
      id: "ic-1",
      role: "Backend Engineer",
      title: "Backend Engineer",
      reportsTo: manager.id,
      status: "idle",
    });
    const db = makeDb(manager, [ic]);

    expect(resolveInternalToolsForAgent(db, manager)).toEqual(["hire_agent"]);
  });
});
