import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../src/main/prompt-builder/index";
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
      connectorId: "openai-codex",
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
      connectorId: "openai-codex",
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

  it("renders projected skills without pi skill shape casts", () => {
    const prompt = buildSystemPrompt(buildCtx({
      skills: [{
        name: "ui<review>&qa",
        description: "Use for A&B \"checks\" and 'snapshots'.",
        filePath: "/tmp/skills/ui<review>&qa/SKILL.md",
        baseDir: "/tmp/skills/ui<review>&qa",
      }],
    }));

    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("<name>ui&lt;review&gt;&amp;qa</name>");
    expect(prompt).toContain("<description>Use for A&amp;B &quot;checks&quot; and &apos;snapshots&apos;.</description>");
    expect(prompt).toContain("<location>/tmp/skills/ui&lt;review&gt;&amp;qa/SKILL.md</location>");
  });
});
