import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => "basic_text",
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

import { AppDatabase } from "../../src/main/database";
import {
  handleBeforeToolCall,
  type ActiveRunContext,
} from "../../src/main/agent-runtime/hook-handlers";

function seedCofounderRun(db: AppDatabase) {
  const companyId = db.core.company.saveCompany({
    name: "Gate Co",
    description: "Cofounder runtime gate test",
    status: "active",
    executionMode: "ai_cofounder",
  });
  db.core.connectors.saveConnector({
    id: "openai-codex",
    model: "gpt-5",
    envBindingText: "",
    notes: "fixture",
  });
  const agentId = db.core.agents.saveAgent({
    companyId,
    name: "Researcher",
    role: "Research Lead",
    title: "Research Lead",
    department: "product",
    status: "active",
    reportsTo: null,
    connectorId: "openai-codex",
    workspaceId: null,
    model: null,
    capabilities: "Research",
    budgetMonthlyUsd: 100,
  });
  const taskId = db.core.tasks.saveTask({
    companyId,
    title: "Draft market plan",
    description: "Prepare the market plan after approval.",
    assigneeAgentId: agentId,
    priority: "high",
    status: "in_progress",
    requiresFilesystem: false,
  });
  const runContext: ActiveRunContext = {
    runId: "run-1",
    agentId,
    companyId,
    taskId,
    connectorId: "openai-codex",
    modelId: "gpt-5",
    taskSessionId: "session-1",
    workspaceId: null,
    workspacePath: null,
    workspaceMode: "none",
    workspaceBaseline: null,
    state: "agent_active",
  };
  return { companyId, agentId, taskId, runContext };
}

describe("cofounder approval runtime gate", () => {
  let tempDir: string;
  let db: AppDatabase;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cofounder-gate-"));
    db = new AppDatabase(tempDir);
    db.init();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("blocks destructive tools while a cofounder plan review is pending", () => {
    const { companyId, agentId, taskId, runContext } = seedCofounderRun(db);
    const approvalId = db.core.approvals.requestApproval({
      companyId,
      relatedTaskId: taskId,
      requestedByAgentId: agentId,
      type: "plan_review",
      payloadSummary: "Review plan",
      impactSummary: "Human approval is required before execution.",
      payloadJson: "{}",
    });

    const blocking = db.core.approvals.getBlockingApproval(companyId, agentId, taskId);
    expect(blocking?.id).toBe(approvalId);

    const result = handleBeforeToolCall(
      {
        db,
        logger: { info: () => {}, warn: () => {}, error: () => {} },
      },
      runContext,
      {
        toolName: "bash",
        toolCallId: "call-1",
        args: { command: "touch blocked.txt" },
      },
    );

    expect(result.block).toBe(true);
    expect(result.reason).toContain("plan_review");
  });
});
