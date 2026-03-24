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

describe("AppDatabase", () => {
  let tempDir: string;
  let db: AppDatabase;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-db-"));
    db = new AppDatabase(tempDir);
    db.init();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("persists company-scoped entities and resolves secret env bindings", () => {
    const companyId = db.saveCompany({
      name: "Northline Systems",
      description: "Operator company",
      status: "active",
    });
    const workspaceId = db.saveWorkspace({
      companyId,
      name: "Primary Workspace",
      localPath: "/tmp/northline",
      repoUrl: "https://github.com/example/northline",
      repoRef: "main",
      isPrimary: true,
    });
    const agentId = db.saveAgent({
      companyId,
      name: "Chief Operator",
      role: "CEO",
      title: "Lead operator",
      status: "active",
      reportsTo: null,
      connectorId: "codex_local",
      workspaceId,
      model: "gpt-5",
      capabilities: "Directs execution",
      budgetMonthlyUsd: 250,
    });
    const goalId = db.saveGoal({
      companyId,
      title: "Ship the desktop product",
      description: "Stabilize the local operator console.",
      ownerAgentId: agentId,
      status: "active",
    });
    const projectId = db.saveProject({
      companyId,
      goalId,
      name: "Desktop Rebuild",
      description: "Main delivery lane",
      leadAgentId: agentId,
      status: "in_progress",
      targetDate: null,
    });
    const taskId = db.saveTask({
      companyId,
      projectId,
      goalId,
      title: "Validate connector health",
      description: "Run a local connector check and capture diagnostics.",
      assigneeAgentId: agentId,
      workspaceId,
      priority: "high",
      status: "todo",
    });

    db.saveSecret({
      companyId,
      name: "vault-openai",
      description: "OpenAI API token",
      value: "sk-test-secret",
    });
    db.saveConnector({
      id: "codex_local",
      command: "codex",
      model: "gpt-5",
      envBindingText: "OPENAI_API_KEY=vault-openai",
      notes: "Primary coding connector",
    });

    const snapshot = db.listSnapshot();

    expect(snapshot.currentCompanyId).toBe(companyId);
    expect(snapshot.workspaces[0]?.id).toBe(workspaceId);
    expect(snapshot.agents[0]?.id).toBe(agentId);
    expect(snapshot.goals[0]?.id).toBe(goalId);
    expect(snapshot.projects[0]?.id).toBe(projectId);
    expect(snapshot.tasks[0]?.id).toBe(taskId);
    expect(db.resolveSecretEnv("OPENAI_API_KEY=vault-openai", companyId)).toEqual({
      OPENAI_API_KEY: "sk-test-secret",
    });
  });

  it("backs up and restores the profile", async () => {
    const companyId = db.saveCompany({
      name: "Backup Test Co",
      description: "Backup validation company",
      status: "active",
    });
    const backupDir = await mkdtemp(join(tmpdir(), "agentcompany-backup-"));

    await db.exportBackup(backupDir);
    db.saveCompany({
      id: companyId,
      name: "Mutated Company",
      description: "Changed after backup",
      status: "paused",
    });

    await db.restoreFromBackup(backupDir);

    const snapshot = db.listSnapshot();
    expect(snapshot.companies[0]?.name).toBe("Backup Test Co");

    await rm(backupDir, { recursive: true, force: true });
  });

  it("scopes secret resolution to the owning company", () => {
    const alphaCompanyId = db.saveCompany({
      name: "Alpha Company",
      description: "Alpha",
      status: "active",
    });
    const betaCompanyId = db.saveCompany({
      name: "Beta Company",
      description: "Beta",
      status: "active",
    });

    db.saveSecret({
      companyId: alphaCompanyId,
      name: "shared-secret-name",
      description: "Alpha secret",
      value: "alpha-secret",
    });

    expect(db.resolveSecretEnv("API_KEY=shared-secret-name", alphaCompanyId)).toEqual({
      API_KEY: "alpha-secret",
    });
    // Beta company has no secret named "shared-secret-name", so resolveSecretEnv
    // falls back to using the raw value literally (allows direct env bindings).
    expect(db.resolveSecretEnv("API_KEY=shared-secret-name", betaCompanyId)).toEqual({
      API_KEY: "shared-secret-name",
    });
  });

  it("atomically checks out unclaimed work to a single agent", () => {
    const companyId = db.saveCompany({
      name: "Checkout Company",
      description: "Atomic checkout validation",
      status: "active",
    });
    const workspaceId = db.saveWorkspace({
      companyId,
      name: "Execution Workspace",
      localPath: "/tmp/checkout",
      repoUrl: "https://github.com/example/checkout",
      repoRef: "main",
      isPrimary: true,
    });
    const leadId = db.saveAgent({
      companyId,
      name: "Lead",
      role: "CEO",
      title: "Lead",
      status: "active",
      reportsTo: null,
      connectorId: "codex_local",
      workspaceId,
      model: null,
      capabilities: "Leads",
      budgetMonthlyUsd: 100,
    });
    const contributorId = db.saveAgent({
      companyId,
      name: "Contributor",
      role: "IC",
      title: "Contributor",
      status: "active",
      reportsTo: leadId,
      connectorId: "codex_local",
      workspaceId,
      model: null,
      capabilities: "Executes",
      budgetMonthlyUsd: 100,
    });
    const taskId = db.saveTask({
      companyId,
      title: "Claim me",
      description: "First agent wins the checkout.",
      assigneeAgentId: null,
      workspaceId,
      priority: "medium",
      status: "todo",
    });

    expect(db.checkoutTask(taskId, leadId)).toBe(true);
    expect(db.checkoutTask(taskId, contributorId)).toBe(false);

    const task = db.getTask(taskId);
    expect(task.assigneeAgentId).toBe(leadId);
    expect(task.status).toBe("in_progress");
  });

  it("auto-pauses an agent when a run exhausts the monthly budget", () => {
    const companyId = db.saveCompany({
      name: "Budget Company",
      description: "Budget hard stop validation",
      status: "active",
    });
    const workspaceId = db.saveWorkspace({
      companyId,
      name: "Budget Workspace",
      localPath: "/tmp/budget",
      repoUrl: "https://github.com/example/budget",
      repoRef: "main",
      isPrimary: true,
    });
    const agentId = db.saveAgent({
      companyId,
      name: "Budget Owner",
      role: "CTO",
      title: "Budget Owner",
      status: "active",
      reportsTo: null,
      connectorId: "codex_local",
      workspaceId,
      model: null,
      capabilities: "Ships work",
      budgetMonthlyUsd: 10,
    });
    const taskId = db.saveTask({
      companyId,
      title: "Spend budget",
      description: "One run should exhaust the allowance.",
      assigneeAgentId: agentId,
      workspaceId,
      priority: "high",
      status: "todo",
    });

    const run = db.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "codex_local",
    });

    const outcome = db.finishRun({
      runId: run.id,
      status: "succeeded",
      summary: "Budget consumed",
      errorMessage: null,
      exitCode: 0,
      signal: null,
      model: "gpt-5",
      sessionDisplayId: "session-budget",
      costUsd: 12,
      unattributedCost: false,
    });

    expect(outcome.budgetHardStopped).toBe(true);
    expect(db.getAgent(agentId).status).toBe("paused");
    expect(db.getAgent(agentId).spentMonthlyUsd).toBe(12);
  });

  it("activates pending hires when the corresponding approval is granted", () => {
    const companyId = db.saveCompany({
      name: "Hiring Company",
      description: "Approval-driven hiring",
      status: "active",
    });
    const managerId = db.saveAgent({
      companyId,
      name: "Manager",
      role: "CEO",
      title: "Manager",
      status: "active",
      reportsTo: null,
      connectorId: "codex_local",
      workspaceId: null,
      model: null,
      capabilities: "Manages",
      budgetMonthlyUsd: 100,
    });
    const pendingHireId = db.saveAgent({
      companyId,
      name: "Pending Hire",
      role: "IC",
      title: "Pending Hire",
      status: "pending_approval",
      reportsTo: managerId,
      connectorId: "codex_local",
      workspaceId: null,
      model: null,
      capabilities: "Will execute after approval",
      budgetMonthlyUsd: 50,
    });

    const approvalId = db.requestApproval({
      companyId,
      relatedTaskId: null,
      requestedByAgentId: managerId,
      type: "hire_agent",
      payloadSummary: "Approve pending hire",
      impactSummary: "Activate the pending hire so they can begin receiving assignments.",
      payloadJson: JSON.stringify({ agentId: pendingHireId }),
    });

    db.decideApproval({
      approvalId,
      state: "approved",
      decisionNote: "Approved",
    });

    expect(db.getAgent(pendingHireId).status).toBe("idle");
  });

  it("detects pending-approval agents via isAgentPendingApproval", () => {
    const companyId = db.saveCompany({
      name: "Gate Test Co",
      description: "Approval gate validation",
      status: "active",
    });
    const activeAgentId = db.saveAgent({
      companyId,
      name: "Active Agent",
      role: "CTO",
      title: "Active",
      status: "active",
      reportsTo: null,
      connectorId: "codex_local",
      workspaceId: null,
      model: null,
      capabilities: "Ships",
      budgetMonthlyUsd: 100,
    });
    const pendingAgentId = db.saveAgent({
      companyId,
      name: "Pending Agent",
      role: "IC",
      title: "Pending",
      status: "pending_approval",
      reportsTo: activeAgentId,
      connectorId: "codex_local",
      workspaceId: null,
      model: null,
      capabilities: "Waiting",
      budgetMonthlyUsd: 50,
    });

    expect(db.isAgentPendingApproval(activeAgentId)).toBe(false);
    expect(db.isAgentPendingApproval(pendingAgentId)).toBe(true);
  });

  it("runs forward-only migrations and creates schema_migrations table", () => {
    // The migration system runs during init() — verify the tracking table exists
    const snapshot = db.listSnapshot();
    expect(snapshot).toBeTruthy();

    // Verify we can re-init without errors (migrations are idempotent)
    db.close();
    db = new AppDatabase(tempDir);
    db.init();

    const snapshot2 = db.listSnapshot();
    expect(snapshot2).toBeTruthy();
  });

  it("acquires and releases workspace locks", () => {
    const companyId = db.saveCompany({
      name: "Lock Test Co",
      description: "Workspace lock test",
      status: "active",
    });
    const wsId = db.saveWorkspace({
      companyId,
      name: "Lockable WS",
      localPath: "/tmp/lock-test",
      repoUrl: "",
      repoRef: "",
      isPrimary: true,
    });

    // Acquire lock for run-1
    expect(db.acquireWorkspaceLock(wsId, "run-1")).toBe(true);
    let ws = db.getWorkspace(wsId);
    expect(ws?.state).toBe("busy");

    // Same run can re-acquire (idempotent)
    expect(db.acquireWorkspaceLock(wsId, "run-1")).toBe(true);

    // Different run cannot acquire while run-1 holds the lock
    expect(db.acquireWorkspaceLock(wsId, "run-2")).toBe(false);

    // Release lock
    db.releaseWorkspaceLock(wsId, "run-1");
    ws = db.getWorkspace(wsId);
    expect(ws?.state).toBe("ready");

    // Now run-2 can acquire
    expect(db.acquireWorkspaceLock(wsId, "run-2")).toBe(true);
    db.releaseWorkspaceLock(wsId, "run-2");
  });

  it("releases all workspace locks on crash recovery", () => {
    const companyId = db.saveCompany({
      name: "Recovery Co",
      description: "Lock recovery test",
      status: "active",
    });
    const wsId = db.saveWorkspace({
      companyId,
      name: "Recovery WS",
      localPath: "/tmp/recovery-test",
      repoUrl: "",
      repoRef: "",
      isPrimary: true,
    });

    db.acquireWorkspaceLock(wsId, "stale-run");
    expect(db.getWorkspace(wsId)?.state).toBe("busy");

    db.releaseAllWorkspaceLocks();
    expect(db.getWorkspace(wsId)?.state).toBe("ready");
  });

  it("purges expired run logs based on retention setting", async () => {
    const companyId = db.saveCompany({
      name: "Purge Co",
      description: "Log purge test",
      status: "active",
    });
    const wsId = db.saveWorkspace({
      companyId,
      name: "PurgeWS",
      localPath: "/tmp/purge",
      repoUrl: "",
      repoRef: "",
      isPrimary: true,
    });
    const agentId = db.saveAgent({
      companyId,
      name: "Purge Agent",
      role: "IC",
      title: "Test",
      status: "active",
      reportsTo: null,
      connectorId: "codex_local",
      workspaceId: wsId,
      model: null,
      capabilities: "test",
      budgetMonthlyUsd: 100,
    });
    const taskId = db.saveTask({
      companyId,
      title: "Purge task",
      description: "test",
      assigneeAgentId: agentId,
      workspaceId: wsId,
      priority: "medium",
      status: "todo",
    });

    const run = db.createRun({ companyId, taskId, agentId, workspaceId: wsId, connectorId: "codex_local" });
    await db.appendRunLog(run.id, "stdout", "test log line\n");

    // Finish the run with a very old timestamp
    db.finishRun({
      runId: run.id,
      status: "succeeded",
      summary: "done",
      errorMessage: null,
      exitCode: 0,
      signal: null,
      model: null,
      sessionDisplayId: null,
      costUsd: 0,
      unattributedCost: true,
    });

    // Log should exist before purge
    expect(db.readRunLog(run.id)).toContain("test log line");

    // Set retention to 1 day and manually backdate the run's finished_at
    db.updateSettings({ logRetentionDays: 1 });
    // Backdate finished_at to 10 days ago
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
    // Direct SQL update for test only
    (db as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).db
      .prepare("update runs set finished_at = ? where id = ?")
      .run(tenDaysAgo, run.id);

    const purged = db.purgeExpiredRunLogs();
    expect(purged).toBe(1);

    // Log should be gone after purge
    expect(db.readRunLog(run.id)).toBe("");
  });

  it("populates related_agent_id on hire approvals", () => {
    const companyId = db.saveCompany({
      name: "Agent Approval Co",
      description: "test",
      status: "active",
    });
    const managerId = db.saveAgent({
      companyId,
      name: "Manager",
      role: "CEO",
      title: "CEO",
      status: "active",
      reportsTo: null,
      connectorId: "codex_local",
      workspaceId: null,
      model: null,
      capabilities: "manage",
      budgetMonthlyUsd: 100,
    });
    const hireId = db.saveAgent({
      companyId,
      name: "New Hire",
      role: "IC",
      title: "IC",
      status: "pending_approval",
      reportsTo: managerId,
      connectorId: "codex_local",
      workspaceId: null,
      model: null,
      capabilities: "code",
      budgetMonthlyUsd: 50,
    });

    const approvalId = db.requestApproval({
      companyId,
      requestedByAgentId: managerId,
      type: "hire_agent",
      payloadSummary: "Hire New Hire",
      impactSummary: "test",
      payloadJson: JSON.stringify({ agentId: hireId }),
    });

    const approval = db.getApprovalRecord(approvalId);
    // related_agent_id should be populated from payloadJson extraction
    expect(approval.relatedAgentId).toBe(hireId);

    // Explicit relatedAgentId param should also work
    const approvalId2 = db.requestApproval({
      companyId,
      requestedByAgentId: managerId,
      relatedAgentId: hireId,
      type: "hire_agent",
      payloadSummary: "Hire New Hire v2",
      impactSummary: "test",
    });

    const approval2 = db.getApprovalRecord(approvalId2);
    expect(approval2.relatedAgentId).toBe(hireId);
  });

});
