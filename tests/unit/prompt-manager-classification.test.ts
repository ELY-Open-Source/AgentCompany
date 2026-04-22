import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSystemPrompt, buildTaskPrompt } from "../../src/main/prompt-builder/index";
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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("keeps the system prompt byte-stable across wall-clock changes", () => {
    const ctx = buildCtx();

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T10:00:00.000Z"));
    const first = buildSystemPrompt(ctx);
    vi.setSystemTime(new Date("2026-04-23T23:59:00.000Z"));
    const second = buildSystemPrompt(ctx);

    expect(second).toBe(first);
  });

  it("keeps volatile task context after the cacheable system prefix", () => {
    const ctx = buildCtx({ wakeReason: "timer" });
    const systemPrompt = buildSystemPrompt(ctx);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T10:00:00.000Z"));
    const first = buildTaskPrompt(ctx);
    vi.setSystemTime(new Date("2026-04-23T23:59:00.000Z"));
    const second = buildTaskPrompt(ctx);

    expect(first.slice(0, systemPrompt.length)).toBe(systemPrompt);
    expect(second.slice(0, systemPrompt.length)).toBe(systemPrompt);
    expect(first.slice(systemPrompt.length)).not.toBe(second.slice(systemPrompt.length));
  });
});
