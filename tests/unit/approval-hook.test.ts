import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../../src/main/database";
import { HumanApprovalHook } from "../../src/main/agent-runtime/approval-hook";

beforeAll(() => {
  process.env.AGENTCOMPANY_ALLOW_INSECURE_VAULT = "true";
});

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("HumanApprovalHook — autonomous contract", () => {
  let tempDir: string;
  let db: AppDatabase;
  const emit = vi.fn();

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-approval-hook-"));
    db = new AppDatabase(tempDir);
    db.init();
    emit.mockClear();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  function scaffoldIds() {
    const companyId = db.saveCompany({
      name: "Approval Co",
      description: "fixture",
      status: "active",
    });
    const workspaceId = db.saveWorkspace({
      companyId,
      name: "Primary",
      localPath: tempDir,
      repoUrl: "",
      repoRef: "",
      isPrimary: true,
    });
    const agentId = db.saveAgent({
      companyId,
      name: "Engineer",
      role: "Engineer",
      title: "Eng",
      status: "running",
      reportsTo: null,
      connectorId: "claude-pro",
      workspaceId,
      model: null,
      capabilities: "Build",
      budgetMonthlyUsd: 100,
    });
    const taskId = db.saveTask({
      companyId,
      title: "Autonomy fixture",
      description: "no gate",
      assigneeAgentId: agentId,
      workspaceId,
      priority: "medium",
      status: "in_progress",
    });
    return { companyId, agentId, taskId };
  }

  it("approves every tool call synchronously without writing an approval row", async () => {
    const { companyId, agentId, taskId } = scaffoldIds();
    const hook = new HumanApprovalHook({ db, emitEvent: emit, logger: noopLogger });
    const verdict = await hook.before("run-1", {
      agentId,
      companyId,
      taskId,
      toolCallId: "tc-1",
      toolName: "bash",
      args: { command: "rm -rf /" },
    });
    expect(verdict).toEqual({});
    const approvals = db.listSnapshot({ companyId }).approvals.filter((a) => a.state === "pending");
    expect(approvals).toHaveLength(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it("approves non-destructive tool calls with the same auto-approve contract", async () => {
    const { companyId, agentId, taskId } = scaffoldIds();
    const hook = new HumanApprovalHook({ db, emitEvent: emit, logger: noopLogger });
    const verdict = await hook.before("run-2", {
      agentId,
      companyId,
      taskId,
      toolCallId: "tc-2",
      toolName: "edit",
      args: { path: "src/foo.ts" },
    });
    expect(verdict).toEqual({});
  });

  it("cancelAll is a no-op because no approvals are queued", async () => {
    const { companyId, agentId, taskId } = scaffoldIds();
    const hook = new HumanApprovalHook({ db, emitEvent: emit, logger: noopLogger });
    const p1 = hook.before("run-x", { agentId, companyId, taskId, toolCallId: "a", toolName: "bash", args: { command: "ls" } });
    const p2 = hook.before("run-x", { agentId, companyId, taskId, toolCallId: "b", toolName: "write", args: { path: "/tmp/x" } });
    hook.cancelAll("Run cancelled.");
    const [v1, v2] = await Promise.all([p1, p2]);
    expect(v1).toEqual({});
    expect(v2).toEqual({});
  });
});
