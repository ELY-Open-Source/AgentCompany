import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildTaskPrompt,
  type PromptContext,
} from "../../src/main/prompt-builder/index";
import type { AgentRecord } from "../../src/shared/types";
import type { FixtureFile, UserTurn } from "./types.js";

const EVAL_DIR = dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = join(EVAL_DIR, "scenarios");

export type EvalPromptAudience =
  | "executive"
  | "manager"
  | "individual_contributor";

export interface EvalScenarioMatrixEntry {
  scenarioId: string;
  audience: EvalPromptAudience;
  requiredSops: string[];
  forbiddenSops?: string[];
}

export interface LoadedScenarioContract {
  fixtureId: string;
  systemPrompt: string;
  userMessage: string;
}

export const EVAL_SCENARIO_MATRIX: EvalScenarioMatrixEntry[] = [
  {
    scenarioId: "ceo-board-message-reply",
    audience: "executive",
    requiredSops: [
      "SOP-001: Daily Standup Protocol",
      "SOP-003: Delegation Protocol",
      "SOP-007: Inter-Agent Communication",
    ],
  },
  {
    scenarioId: "ceo-bootstrap-empty",
    audience: "executive",
    requiredSops: [
      "SOP-003: Delegation Protocol",
      "SOP-005: Hiring Protocol",
      "SOP-014: Hiring Pipeline",
    ],
  },
  {
    scenarioId: "ic-task-execute",
    audience: "individual_contributor",
    requiredSops: [
      "SOP-002: Task Lifecycle",
      "SOP-011: Performance & Quality Standards",
    ],
    forbiddenSops: [
      "SOP-005: Hiring Protocol",
      "SOP-010: Budget & Financial Protocol",
      "SOP-014: Hiring Pipeline",
    ],
  },
  {
    scenarioId: "manager-task-handoff",
    audience: "manager",
    requiredSops: [
      "SOP-002: Task Lifecycle",
      "SOP-003: Delegation Protocol",
      "SOP-004: Code Review Protocol",
    ],
  },
  {
    scenarioId: "non-ceo-dm-reply",
    audience: "manager",
    requiredSops: [
      "SOP-001: Daily Standup Protocol",
      "SOP-007: Inter-Agent Communication",
      "SOP-008: Cross-Department Collaboration",
    ],
  },
  {
    scenarioId: "ceo-budget-cadence-incident",
    audience: "executive",
    requiredSops: [
      "SOP-006: Escalation Chain",
      "SOP-010: Budget & Financial Protocol",
      "SOP-012: Sprint & Cadence Management",
      "SOP-013: Incident Response Protocol",
    ],
  },
  {
    scenarioId: "manager-docs-knowledge-handoff",
    audience: "manager",
    requiredSops: [
      "SOP-006: Escalation Chain",
      "SOP-009: Document Management",
      "SOP-013: Incident Response Protocol",
      "SOP-015: Knowledge Management",
    ],
  },
];

function createAgent(overrides: Partial<AgentRecord>): AgentRecord {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "Agent",
    role: "Engineer",
    title: "Engineer",
    roleLevel: "ic",
    department: "engineering",
    status: "active",
    reportsTo: "manager-1",
    connectorId: "openai-codex",
    workspaceId: null,
    model: null,
    capabilities: "Build production software",
    budgetMonthlyUsd: 200,
    spentMonthlyUsd: 0,
    metadataJson: "{}",
    heartbeatEnabled: true,
    heartbeatIntervalSec: 120,
    lastHeartbeatAt: null,
    createdAt: "2026-04-20T00:00:00.000Z",
    updatedAt: "2026-04-20T00:00:00.000Z",
    ...overrides,
  };
}

function buildPromptContext(audience: EvalPromptAudience): PromptContext {
  const ceo = createAgent({
    id: "ceo-1",
    name: "CEO",
    role: "CEO",
    title: "Chief Executive Officer",
    roleLevel: "c_suite",
    department: "executive",
    reportsTo: null,
    capabilities: "Lead the company",
  });
  const manager = createAgent({
    id: "manager-1",
    name: "VP Engineering",
    role: "VP Engineering",
    title: "VP Engineering",
    roleLevel: "vp",
    department: "engineering",
    reportsTo: ceo.id,
    capabilities: "Run engineering delivery",
  });
  const ic = createAgent({
    id: "ic-1",
    name: "Backend IC",
    role: "Backend Engineer",
    title: "Backend Engineer",
    roleLevel: "ic",
    department: "engineering",
    reportsTo: manager.id,
    capabilities: "Implement backend tasks",
  });

  const agent =
    audience === "executive" ? ceo : audience === "manager" ? manager : ic;
  const directReports =
    audience === "executive" ? [manager] : audience === "manager" ? [ic] : [];
  const chainOfCommand =
    audience === "executive" ? [] : audience === "manager" ? [ceo] : [manager, ceo];

  return {
    agent,
    apiUrl: "http://127.0.0.1:3000",
    apiKey: "eval-token",
    runId: "eval-run",
    task: null,
    companyName: "AgentCompany Eval",
    companyDescription: "Recorded eval prompt coverage",
    goals: [],
    projects: [],
    directReports,
    chainOfCommand,
    assignedTasks: [],
    allAgents: [ceo, manager, ic],
    pendingApprovals: [],
    tasksAwaitingReview: [],
    wakeReason: null,
    allTasks: [],
    recentComments: [],
    socialAccounts: [],
  };
}

function hashSystemPrompt(systemPrompt: string): string {
  return `sha256:${createHash("sha256").update(systemPrompt).digest("hex")}`;
}

function getFirstUserText(fixture: FixtureFile): string {
  const first = fixture.turns[0];
  if (!first || first.role !== "user") {
    throw new Error(
      `eval scenario: fixture "${fixture.meta.fixtureId}" must start with a user turn`,
    );
  }
  const userTurn = first as UserTurn;
  if (!Array.isArray(userTurn.content)) {
    throw new Error(
      `eval scenario: fixture "${fixture.meta.fixtureId}" first user turn must use content blocks`,
    );
  }
  return userTurn.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
}

export async function loadScenarioContract(
  fixtureId: string,
): Promise<LoadedScenarioContract> {
  const root = join(SCENARIO_DIR, fixtureId);
  const [systemPrompt, userMessage] = await Promise.all([
    readFile(join(root, "system.txt"), "utf8"),
    readFile(join(root, "user.txt"), "utf8"),
  ]);
  if (systemPrompt.length === 0) {
    throw new Error(`eval scenario: ${fixtureId}/system.txt is empty`);
  }
  if (userMessage.length === 0) {
    throw new Error(`eval scenario: ${fixtureId}/user.txt is empty`);
  }
  return {
    fixtureId,
    systemPrompt,
    userMessage,
  };
}

export function assertScenarioMatchesFixture(
  fixture: FixtureFile,
  scenario: LoadedScenarioContract,
): void {
  const expectedHash = hashSystemPrompt(scenario.systemPrompt);
  if (fixture.meta.systemPromptHash !== expectedHash) {
    throw new Error(
      `eval scenario: fixture "${fixture.meta.fixtureId}" has systemPromptHash ${fixture.meta.systemPromptHash}, expected ${expectedHash}`,
    );
  }
  const fixtureUserText = getFirstUserText(fixture);
  if (fixtureUserText !== scenario.userMessage) {
    throw new Error(
      `eval scenario: fixture "${fixture.meta.fixtureId}" first user turn does not match scenarios/${scenario.fixtureId}/user.txt`,
    );
  }
}

export function buildMatrixPrompt(entry: EvalScenarioMatrixEntry): string {
  return buildTaskPrompt(buildPromptContext(entry.audience));
}
