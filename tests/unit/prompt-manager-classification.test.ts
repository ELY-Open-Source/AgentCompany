import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../src/main/prompt-builder";
import type { PromptContext } from "../../src/main/prompt-builder/index";

function buildCtx(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "CTO",
      role: "CTO",
      title: "Chief Technology Officer",
      roleLevel: "c_suite",
      department: "engineering",
      status: "active",
      reportsTo: "ceo-1",
      connectorId: "codex_local",
      workspaceId: null,
      model: null,
      capabilities: "Lead engineering",
      budgetMonthlyUsd: 200,
      spentMonthlyUsd: 0,
      metadataJson: "{}",
      heartbeatEnabled: true,
      heartbeatIntervalSec: 120,
      lastHeartbeatAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    apiUrl: "http://127.0.0.1:3210",
    apiKey: "token",
    runId: "run-1",
    task: null,
    companyName: "Prompt Co",
    companyDescription: "Tests leadership prompt classification",
    goals: [],
    projects: [],
    directReports: [],
    chainOfCommand: [{
      id: "ceo-1",
      companyId: "company-1",
      name: "CEO",
      role: "CEO",
      title: "Chief Executive Officer",
      roleLevel: "c_suite",
      department: "executive",
      status: "active",
      reportsTo: null,
      connectorId: "codex_local",
      workspaceId: null,
      model: null,
      capabilities: "Lead the company",
      budgetMonthlyUsd: 250,
      spentMonthlyUsd: 0,
      metadataJson: "{}",
      heartbeatEnabled: true,
      heartbeatIntervalSec: 120,
      lastHeartbeatAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }],
    assignedTasks: [],
    allAgents: [],
    pendingApprovals: [],
    tasksAwaitingReview: [],
    wakeReason: null,
    allTasks: [],
    recentComments: [],
    socialAccounts: [],
    ...overrides,
  };
}

describe("buildSystemPrompt leadership classification", () => {
  it("treats first-layer executive leaders as managers even before they have direct reports", () => {
    const prompt = buildSystemPrompt(buildCtx());

    expect(prompt).toContain("Operating Instructions (Manager)");
    expect(prompt).toContain("New hires for your team should report to you by default");
    expect(prompt).not.toContain("Operating Instructions (Individual Contributor)");
  });
});
