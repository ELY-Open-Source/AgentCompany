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

describe("HumanApprovalHook", () => {
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

  function scaffold() {
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
      connectorId: "claude_local",
      workspaceId,
      model: null,
      capabilities: "Build",
      budgetMonthlyUsd: 100,
    });
    const taskId = db.saveTask({
      companyId,
      title: "Bash review fixture",
      description: "needs approval",
      assigneeAgentId: agentId,
      workspaceId,
      priority: "medium",
      status: "in_progress",
    });
    return { companyId, workspaceId, agentId, taskId };
  }

  it("blocks the tool call with the approval note when the user denies", async () => {
    const { companyId, agentId, taskId } = scaffold();
    const hook = new HumanApprovalHook({ db, emitEvent: emit, logger: noopLogger });
    const promise = hook.before("run-1", {
      agentId,
      companyId,
      taskId,
      toolCallId: "tc-1",
      toolName: "bash",
      args: { command: "rm -rf /" },
    });
    // Allow the approval row to be written before resolving.
    await new Promise((resolve) => setImmediate(resolve));
    const approvals = db.listSnapshot({ companyId }).approvals.filter((a) => a.state === "pending");
    expect(approvals).toHaveLength(1);
    const approvalId = approvals[0]!.id;
    const resolved = hook.resolveApproval(approvalId, "reject", "denied: dangerous");
    expect(resolved).toBe(true);
    const verdict = await promise;
    expect(verdict.block).toBe(true);
    expect(verdict.reason).toBe("denied: dangerous");
  });

  it("approves the tool call when the user approves", async () => {
    const { companyId, agentId, taskId } = scaffold();
    const hook = new HumanApprovalHook({ db, emitEvent: emit, logger: noopLogger });
    const promise = hook.before("run-2", {
      agentId,
      companyId,
      taskId,
      toolCallId: "tc-2",
      toolName: "edit",
      args: { path: "src/foo.ts" },
    });
    await new Promise((resolve) => setImmediate(resolve));
    const approvals = db.listSnapshot({ companyId }).approvals.filter((a) => a.state === "pending");
    const approvalId = approvals[0]!.id;
    hook.resolveApproval(approvalId, "approve", "");
    const verdict = await promise;
    expect(verdict.block).toBeUndefined();
  });

  it("cancelAll resolves every pending approval as blocked", async () => {
    const { companyId, agentId, taskId } = scaffold();
    const hook = new HumanApprovalHook({ db, emitEvent: emit, logger: noopLogger });
    const p1 = hook.before("run-x", { agentId, companyId, taskId, toolCallId: "a", toolName: "bash", args: { command: "ls" } });
    const p2 = hook.before("run-x", { agentId, companyId, taskId, toolCallId: "b", toolName: "write", args: { path: "/tmp/x" } });
    await new Promise((resolve) => setImmediate(resolve));
    hook.cancelAll("Run cancelled.");
    const [v1, v2] = await Promise.all([p1, p2]);
    expect(v1.block).toBe(true);
    expect(v2.block).toBe(true);
  });
});
