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

function buildTask(overrides: Partial<NonNullable<PromptContext["task"]>> = {}): NonNullable<PromptContext["task"]> {
  const now = new Date().toISOString();
  return {
    id: "task-1",
    companyId: "company-1",
    projectId: null,
    goalId: null,
    parentId: null,
    title: "Ship volatile task",
    description: "This task should live in the volatile prompt tail.",
    assigneeAgentId: "agent-1",
    workspaceId: null,
    status: "in_progress",
    priority: "high",
    activeRunId: null,
    costUsd: 0,
    taskType: null,
    requiresUserReview: false,
    requiresFilesystem: false,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildApproval(overrides: Partial<PromptContext["pendingApprovals"][number]> = {}): PromptContext["pendingApprovals"][number] {
  const now = new Date().toISOString();
  return {
    id: "approval-1",
    companyId: "company-1",
    relatedTaskId: null,
    relatedAgentId: null,
    requestedByAgentId: "agent-1",
    type: "approve_ceo_strategy",
    payloadSummary: "Review the volatile org gate.",
    impactSummary: "Board decision required.",
    payloadJson: null,
    decisionNote: "",
    state: "pending",
    createdAt: now,
    updatedAt: now,
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

  it("keeps run, locale, and task context out of the stable system prompt", () => {
    const ctx = buildCtx({
      runId: "run-volatile",
      locale: "zh",
      task: buildTask(),
      wakeReason: "assignment",
    });

    const stablePrompt = buildSystemPrompt(ctx);
    const fullPrompt = buildTaskPrompt(ctx);

    expect(stablePrompt).not.toContain("run-volatile");
    expect(stablePrompt).not.toContain("Ship volatile task");
    expect(stablePrompt).not.toContain("Respond to the user in Chinese.");
    expect(stablePrompt).not.toContain("{{runId}}");
    expect(stablePrompt).toContain("$AGENT_COMPANY_RUN_ID");
    expect(fullPrompt).toContain("Current Run ID: run-volatile");
    expect(fullPrompt).toContain("Ship volatile task");
    expect(fullPrompt).toContain("Respond to the user in Chinese.");
  });

  it("keeps the stable prefix identical across volatile run changes", () => {
    const firstCtx = buildCtx({
      runId: "run-a",
      locale: "en",
      task: buildTask({ id: "task-a", title: "First volatile task" }),
      wakeReason: "timer",
    });
    const secondCtx = buildCtx({
      runId: "run-b",
      locale: "zh",
      task: buildTask({ id: "task-b", title: "Second volatile task" }),
      wakeReason: "assignment",
    });

    const firstStable = buildSystemPrompt(firstCtx);
    const secondStable = buildSystemPrompt(secondCtx);
    const secondFull = buildTaskPrompt(secondCtx);

    expect(secondStable).toBe(firstStable);
    expect(secondFull.slice(0, secondStable.length)).toBe(secondStable);
    expect(secondFull.slice(secondStable.length)).toContain("Second volatile task");
  });

  it("keeps approval gates and workload counts out of the stable system prompt", () => {
    const baseAgent = buildCtx().agent;
    const report = {
      ...baseAgent,
      id: "report-1",
      name: "Engineer",
      role: "Engineer",
      title: "Staff Engineer",
      reportsTo: baseAgent.id,
    };
    const stableBase = buildCtx({
      chainOfCommand: [],
      directReports: [report],
      allAgents: [baseAgent, report],
      allTasks: [buildTask({ id: "report-task", assigneeAgentId: report.id, status: "todo" })],
      pendingApprovals: [],
    });
    const volatileChanged = buildCtx({
      chainOfCommand: [],
      directReports: [report],
      allAgents: [baseAgent, report],
      allTasks: [buildTask({ id: "report-task", assigneeAgentId: report.id, status: "blocked" })],
      pendingApprovals: [buildApproval()],
    });

    const stablePrompt = buildSystemPrompt(stableBase);
    const changedStablePrompt = buildSystemPrompt(volatileChanged);
    const changedFullPrompt = buildTaskPrompt(volatileChanged);

    expect(changedStablePrompt).toBe(stablePrompt);
    expect(changedFullPrompt).toContain("Pending Approvals");
    expect(changedFullPrompt).toContain("1 blocked");
  });

  it("keeps heartbeat skip state out of the task prompt", () => {
    const ctx = buildCtx() as PromptContext & {
      heartbeatSkip: { reason: string; streak: number; since: string; lastTickAt: string };
    };
    ctx.heartbeatSkip = {
      reason: "worker_not_ready",
      streak: 7,
      since: "2026-04-23T00:00:00.000Z",
      lastTickAt: "2026-04-23T00:10:00.000Z",
    };

    const prompt = buildTaskPrompt(ctx);

    expect(prompt).not.toContain("Heartbeat Skip Status");
    expect(prompt).not.toContain("worker_not_ready");
    expect(prompt).not.toContain("Consecutive skips");
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
