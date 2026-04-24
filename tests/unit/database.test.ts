import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { approvalTypeEnum } from "../../src/shared/types";

beforeAll(() => {
  process.env.AGENTCOMPANY_ALLOW_INSECURE_VAULT = "true";
});

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => "basic_text",
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

import { AppDatabase } from "../../src/main/database";
import { installBaselineSchema } from "../../src/main/database/migrations/baseline-v56";
import { markBaselineSchema } from "../../src/main/database/migrations/legacy-to-v56";

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

  it("keeps task runtime ownership in task_leases", () => {
    const leaseTables = db.queryAll<{ name: string }>(
      "select name from sqlite_master where type = 'table' and name = 'task_leases'",
    );
    const removedTaskColumns = new Set([
      "phase",
      "active_run_id",
      "checkout_run_id",
      "execution_locked_at",
      "active_session_id",
    ]);
    const taskColumns = db.queryAll<{ name: string }>("pragma table_info(tasks)")
      .filter((column) => removedTaskColumns.has(column.name));
    const phaseTriggers = db.queryAll<{ name: string }>(
      "select name from sqlite_master where type = 'trigger' and name like 'trg_tasks_phase_from_status_%'",
    );

    expect(leaseTables).toEqual([{ name: "task_leases" }]);
    expect(taskColumns).toEqual([]);
    expect(phaseTriggers).toEqual([]);
  });

  it("persists company-scoped entities and resolves secret env bindings", () => {
    const companyId = db.core.company.saveCompany({
      name: "Northline Systems",
      description: "Operator company",
      status: "active",
    });
    const workspaceId = db.core.workspaces.saveWorkspace({
      companyId,
      name: "Primary Workspace",
      localPath: "/tmp/northline",
      repoUrl: "https://github.com/example/northline",
      repoRef: "main",
      isPrimary: true,
    });
    const agentId = db.core.agents.saveAgent({
      companyId,
      name: "Chief Operator",
      role: "CEO",
      title: "Lead operator",
      status: "active",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId,
      model: "gpt-5",
      capabilities: "Directs execution",
      budgetMonthlyUsd: 250,
    });
    const goalId = db.core.entity.saveGoal({
      companyId,
      title: "Ship the desktop product",
      description: "Stabilize the local operator console.",
      ownerAgentId: agentId,
      status: "active",
    });
    const projectId = db.core.entity.saveProject({
      companyId,
      goalId,
      name: "Desktop Rebuild",
      description: "Main delivery lane",
      leadAgentId: agentId,
      status: "in_progress",
      targetDate: null,
    });
    const taskId = db.core.tasks.saveTask({
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

    db.core.entity.saveSecret({
      companyId,
      name: "vault-openai",
      description: "OpenAI API token",
      value: "sk-test-secret",
    });
    db.core.connectors.saveConnector({
      id: "openai-codex",
      model: "gpt-5",
      envBindingText: "OPENAI_API_KEY=vault-openai",
      notes: "Primary coding connector",
    });

    const snapshot = db.projection.snapshot.listSnapshot();

    expect(snapshot.currentCompanyId).toBe(companyId);
    expect(snapshot.workspaces[0]?.id).toBe(workspaceId);
    expect(snapshot.agents[0]?.id).toBe(agentId);
    expect(snapshot.goals[0]?.id).toBe(goalId);
    expect(snapshot.projects[0]?.id).toBe(projectId);
    expect(snapshot.tasks[0]?.id).toBe(taskId);
    expect(db.core.entity.resolveSecretEnv("OPENAI_API_KEY=vault-openai", companyId)).toEqual({
      OPENAI_API_KEY: "sk-test-secret",
    });
  });

  it("backs up and restores the profile", async () => {
    const companyId = db.core.company.saveCompany({
      name: "Backup Test Co",
      description: "Backup validation company",
      status: "active",
    });
    const backupDir = await mkdtemp(join(tmpdir(), "agentcompany-backup-"));

    await db.core.backup.exportBackup(backupDir);
    db.core.company.saveCompany({
      id: companyId,
      name: "Mutated Company",
      description: "Changed after backup",
      status: "paused",
    });

    await db.core.backup.restoreFromBackup(backupDir);

    const snapshot = db.projection.snapshot.listSnapshot();
    expect(snapshot.companies[0]?.name).toBe("Backup Test Co");

    await rm(backupDir, { recursive: true, force: true });
  });

  it("scopes secret resolution to the owning company", () => {
    const alphaCompanyId = db.core.company.saveCompany({
      name: "Alpha Company",
      description: "Alpha",
      status: "active",
    });
    const betaCompanyId = db.core.company.saveCompany({
      name: "Beta Company",
      description: "Beta",
      status: "active",
    });

    db.core.entity.saveSecret({
      companyId: alphaCompanyId,
      name: "shared-secret-name",
      description: "Alpha secret",
      value: "alpha-secret",
    });

    expect(db.core.entity.resolveSecretEnv("API_KEY=shared-secret-name", alphaCompanyId)).toEqual({
      API_KEY: "alpha-secret",
    });
    // Beta company has no secret named "shared-secret-name", so resolveSecretEnv
    // falls back to using the raw value literally (allows direct env bindings).
    expect(db.core.entity.resolveSecretEnv("API_KEY=shared-secret-name", betaCompanyId)).toEqual({
      API_KEY: "shared-secret-name",
    });
  });

  it("atomically checks out unclaimed work via CAS with run ID", () => {
    const companyId = db.core.company.saveCompany({
      name: "Checkout Company",
      description: "Atomic checkout validation",
      status: "active",
    });
    const workspaceId = db.core.workspaces.saveWorkspace({
      companyId,
      name: "Execution Workspace",
      localPath: "/tmp/checkout",
      repoUrl: "https://github.com/example/checkout",
      repoRef: "main",
      isPrimary: true,
    });
    const leadId = db.core.agents.saveAgent({
      companyId,
      name: "Lead",
      role: "CEO",
      title: "Lead",
      status: "active",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId,
      model: null,
      capabilities: "Leads",
      budgetMonthlyUsd: 100,
    });
    db.core.connectors.saveConnector({
      id: "openai-codex",
      model: "gpt-5",
      envBindingText: "",
      notes: "Test connector",
    });
    const taskId = db.core.tasks.saveTask({
      companyId,
      title: "Claim me",
      description: "First agent wins the checkout.",
      assigneeAgentId: null,
      workspaceId,
      priority: "medium",
      status: "todo",
    });

    const { id: runId1 } = db.core.runs.createRun({
      companyId,
      taskId,
      agentId: leadId,
      workspaceId,
      connectorId: "openai-codex",
    });
    const { id: runId2 } = db.core.runs.createRun({
      companyId,
      taskId,
      agentId: leadId,
      workspaceId,
      connectorId: "openai-codex",
    });

    expect(db.core.tasks.checkoutTask(taskId, runId1)).toBe(true);
    expect(db.core.tasks.checkoutTask(taskId, runId2)).toBe(false);

    const task = db.core.entity.getTask(taskId);
    expect(task.status).toBe("in_progress");
  });

  it("auto-pauses an agent when a run exhausts the monthly budget", () => {
    const companyId = db.core.company.saveCompany({
      name: "Budget Company",
      description: "Budget hard stop validation",
      status: "active",
    });
    const workspaceId = db.core.workspaces.saveWorkspace({
      companyId,
      name: "Budget Workspace",
      localPath: "/tmp/budget",
      repoUrl: "https://github.com/example/budget",
      repoRef: "main",
      isPrimary: true,
    });
    const agentId = db.core.agents.saveAgent({
      companyId,
      name: "Budget Owner",
      role: "CTO",
      title: "Budget Owner",
      status: "active",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId,
      model: null,
      capabilities: "Ships work",
      budgetMonthlyUsd: 10,
    });
    const taskId = db.core.tasks.saveTask({
      companyId,
      title: "Spend budget",
      description: "One run should exhaust the allowance.",
      assigneeAgentId: agentId,
      workspaceId,
      priority: "high",
      status: "todo",
    });

    const run = db.core.runs.createRun({
      companyId,
      taskId,
      agentId,
      workspaceId,
      connectorId: "openai-codex",
    });

    // Simulate a per-message cost entry (written by CostWriter in prod).
    db.core.runs.recordCostEntry({
      runId: run.id,
      companyId,
      agentId,
      taskId,
      connectorId: "openai-codex",
      amountUsd: 12,
      unattributed: false,
    });

    const outcome = db.core.runs.finishRun({
      runId: run.id,
      status: "succeeded",
      summary: "Budget consumed",
      errorMessage: null,
      exitCode: 0,
      signal: null,
      model: "gpt-5",
      unattributedCost: false,
    });

    expect(outcome.budgetHardStopped).toBe(true);
    expect(db.core.entity.getAgent(agentId).status).toBe("paused");
    expect(db.core.entity.getAgent(agentId).spentMonthlyUsd).toBe(12);
  });

  it("persists explicit run usage status", () => {
    const companyId = db.core.company.saveCompany({
      name: "Usage Status Company",
      description: "Tracks run usage status",
      status: "active",
    });
    const workspaceId = db.core.workspaces.saveWorkspace({
      companyId,
      name: "Usage Workspace",
      localPath: "/tmp/usage-status",
      repoUrl: "",
      repoRef: "",
      isPrimary: true,
    });
    const agentId = db.core.agents.saveAgent({
      companyId,
      name: "Usage Agent",
      role: "Engineer",
      title: "Engineer",
      status: "active",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId,
      model: "gpt-5",
      capabilities: "Run tasks",
      budgetMonthlyUsd: 100,
    });
    const taskId = db.core.tasks.saveTask({
      companyId,
      title: "Usage task",
      description: "Exercise explicit usage status.",
      assigneeAgentId: agentId,
      workspaceId,
      priority: "medium",
      status: "in_progress",
    });
    const run = db.core.runs.createRun({ companyId, taskId, agentId, workspaceId, connectorId: "openai-codex" });

    db.core.runs.finishRun({
      runId: run.id,
      status: "failed",
      summary: null,
      errorMessage: "stream setup failed",
      exitCode: null,
      signal: null,
      model: "gpt-5",
      unattributedCost: true,
      usageStatus: "error_stop",
    });

    expect(db.core.runs.getRun(run.id).usageStatus).toBe("error_stop");
    expect(db.projection.snapshot.listSnapshot().runs.find((record) => record.id === run.id)?.usageStatus).toBe("error_stop");
  });

  it("activates pending hires when the corresponding approval is granted", () => {
    const companyId = db.core.company.saveCompany({
      name: "Hiring Company",
      description: "Approval-driven hiring",
      status: "active",
    });
    const managerId = db.core.agents.saveAgent({
      companyId,
      name: "Manager",
      role: "CEO",
      title: "Manager",
      status: "active",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId: null,
      model: null,
      capabilities: "Manages",
      budgetMonthlyUsd: 100,
    });
    const pendingHireId = db.core.agents.saveAgent({
      companyId,
      name: "Pending Hire",
      role: "IC",
      title: "Pending Hire",
      status: "pending_approval",
      reportsTo: managerId,
      connectorId: "openai-codex",
      workspaceId: null,
      model: null,
      capabilities: "Will execute after approval",
      budgetMonthlyUsd: 50,
    });

    const approvalId = db.core.approvals.requestApproval({
      companyId,
      relatedTaskId: null,
      requestedByAgentId: managerId,
      type: "hire_agent",
      payloadSummary: "Approve pending hire",
      impactSummary: "Activate the pending hire so they can begin receiving assignments.",
      payloadJson: JSON.stringify({ agentId: pendingHireId }),
    });

    db.core.approvals.decideApproval({
      approvalId,
      state: "approved",
      decisionNote: "Approved",
    });

    expect(db.core.entity.getAgent(pendingHireId).status).toBe("idle");
  });

  it("detects pending-approval agents via isAgentPendingApproval", () => {
    const companyId = db.core.company.saveCompany({
      name: "Gate Test Co",
      description: "Approval gate validation",
      status: "active",
    });
    const activeAgentId = db.core.agents.saveAgent({
      companyId,
      name: "Active Agent",
      role: "CTO",
      title: "Active",
      status: "active",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId: null,
      model: null,
      capabilities: "Ships",
      budgetMonthlyUsd: 100,
    });
    const pendingAgentId = db.core.agents.saveAgent({
      companyId,
      name: "Pending Agent",
      role: "IC",
      title: "Pending",
      status: "pending_approval",
      reportsTo: activeAgentId,
      connectorId: "openai-codex",
      workspaceId: null,
      model: null,
      capabilities: "Waiting",
      budgetMonthlyUsd: 50,
    });

    expect(db.core.agents.isAgentPendingApproval(activeAgentId)).toBe(false);
    expect(db.core.agents.isAgentPendingApproval(pendingAgentId)).toBe(true);
  });

  it("installs the v56 baseline and v57 task leases once on a fresh profile", () => {
    const migrations = db.queryAll<{ version: number; name: string }>(
      "select version, name from schema_migrations order by version",
    );
    expect(migrations).toEqual([
      { version: 56, name: "baseline_v56" },
      { version: 57, name: "task_leases_runtime_ownership" },
      { version: 58, name: "approval_policy_table" },
    ]);

    db.close();
    db = new AppDatabase(tempDir);
    db.init();

    const migrationsAfterReinit = db.queryAll<{ version: number; name: string }>(
      "select version, name from schema_migrations order by version",
    );
    expect(migrationsAfterReinit).toEqual([
      { version: 56, name: "baseline_v56" },
      { version: 57, name: "task_leases_runtime_ownership" },
      { version: 58, name: "approval_policy_table" },
    ]);
  });

  it("migrates v56 task ownership columns into task_leases", async () => {
    const legacyDir = await mkdtemp(join(tmpdir(), "agentcompany-v56-lease-"));
    const rawDb = new DatabaseSync(join(legacyDir, "profile.sqlite"));
    const ts = "2026-04-24T00:00:00.000Z";
    try {
      installBaselineSchema(rawDb);
      markBaselineSchema(rawDb);
      rawDb
        .prepare("insert into companies (id, name, description, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?)")
        .run("company-1", "Lease Co", "", "active", ts, ts);
      rawDb
        .prepare("insert into agents (id, company_id, name, role, title, status, reports_to, connector_id, workspace_id, capabilities, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run("agent-1", "company-1", "Worker", "IC", "Worker", "active", null, "openai-codex", null, "Executes", ts, ts);
      rawDb
        .prepare("insert into tasks (id, company_id, title, description, assignee_agent_id, status, priority, active_run_id, checkout_run_id, execution_locked_at, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run("task-1", "company-1", "Lease task", "", "agent-1", "in_progress", "medium", "run-1", "run-1", ts, ts, ts);
      rawDb
        .prepare("insert into runs (id, company_id, task_id, agent_id, connector_id, status, summary, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run("run-1", "company-1", "task-1", "agent-1", "openai-codex", "queued", "", ts, ts);
    } finally {
      rawDb.close();
    }

    const legacyAppDb = new AppDatabase(legacyDir);
    try {
      legacyAppDb.init();
      expect(
        legacyAppDb.queryAll<{ taskId: string; runId: string; agentId: string }>(
          "select task_id as taskId, run_id as runId, agent_id as agentId from task_leases",
        ),
      ).toEqual([{ taskId: "task-1", runId: "run-1", agentId: "agent-1" }]);
      const columns = legacyAppDb.queryAll<{ name: string }>("pragma table_info(tasks)").map((column) => column.name);
      expect(columns).not.toContain("active_run_id");
      expect(columns).not.toContain("checkout_run_id");
      expect(columns).not.toContain("execution_locked_at");
    } finally {
      legacyAppDb.close();
      await rm(legacyDir, { recursive: true, force: true });
    }
  });

  it("seeds approval policies for every approval type", () => {
    const rows = db.queryAll<{
      approvalType: string;
      scopeType: string;
      blocksExecution: number;
      requiredMode: string;
      autoApprovable: number;
    }>(
      "select approval_type as approvalType, scope_type as scopeType, blocks_execution as blocksExecution, required_mode as requiredMode, auto_approvable as autoApprovable from approval_policies order by approval_type",
    );
    expect(rows.map((row) => row.approvalType).sort()).toEqual([...approvalTypeEnum.options].sort());
    expect(rows.find((row) => row.approvalType === "plan_review")).toMatchObject({
      scopeType: "requester_or_task",
      blocksExecution: 1,
      requiredMode: "ai_cofounder",
      autoApprovable: 0,
    });
    expect(rows.find((row) => row.approvalType === "dangerous_command")).toMatchObject({
      scopeType: "requester_or_task",
      blocksExecution: 1,
      requiredMode: "any",
    });
    expect(rows.find((row) => row.approvalType === "hire_agent")).toMatchObject({
      scopeType: "related_agent",
      blocksExecution: 1,
      requiredMode: "any",
      autoApprovable: 1,
    });
  });

  it("acquires and releases workspace locks", () => {
    const companyId = db.core.company.saveCompany({
      name: "Lock Test Co",
      description: "Workspace lock test",
      status: "active",
    });
    const wsId = db.core.workspaces.saveWorkspace({
      companyId,
      name: "Lockable WS",
      localPath: "/tmp/lock-test",
      repoUrl: "",
      repoRef: "",
      isPrimary: true,
    });

    // Acquire lock for run-1
    expect(db.core.workspaces.acquireWorkspaceLock(wsId, "run-1")).toBe(true);
    let ws = db.core.workspaces.getWorkspace(wsId);
    expect(ws?.state).toBe("busy");

    // Same run can re-acquire (idempotent)
    expect(db.core.workspaces.acquireWorkspaceLock(wsId, "run-1")).toBe(true);

    // Different run cannot acquire while run-1 holds the lock
    expect(db.core.workspaces.acquireWorkspaceLock(wsId, "run-2")).toBe(false);

    // Release lock
    db.core.workspaces.releaseWorkspaceLock(wsId, "run-1");
    ws = db.core.workspaces.getWorkspace(wsId);
    expect(ws?.state).toBe("ready");

    // Now run-2 can acquire
    expect(db.core.workspaces.acquireWorkspaceLock(wsId, "run-2")).toBe(true);
    db.core.workspaces.releaseWorkspaceLock(wsId, "run-2");
  });

  it("releases all workspace locks on crash recovery", () => {
    const companyId = db.core.company.saveCompany({
      name: "Recovery Co",
      description: "Lock recovery test",
      status: "active",
    });
    const wsId = db.core.workspaces.saveWorkspace({
      companyId,
      name: "Recovery WS",
      localPath: "/tmp/recovery-test",
      repoUrl: "",
      repoRef: "",
      isPrimary: true,
    });

    db.core.workspaces.acquireWorkspaceLock(wsId, "stale-run");
    expect(db.core.workspaces.getWorkspace(wsId)?.state).toBe("busy");

    db.core.workspaces.releaseAllWorkspaceLocks();
    expect(db.core.workspaces.getWorkspace(wsId)?.state).toBe("ready");
  });

  it("purges expired run logs based on retention setting", async () => {
    const companyId = db.core.company.saveCompany({
      name: "Purge Co",
      description: "Log purge test",
      status: "active",
    });
    const wsId = db.core.workspaces.saveWorkspace({
      companyId,
      name: "PurgeWS",
      localPath: "/tmp/purge",
      repoUrl: "",
      repoRef: "",
      isPrimary: true,
    });
    const agentId = db.core.agents.saveAgent({
      companyId,
      name: "Purge Agent",
      role: "IC",
      title: "Test",
      status: "active",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId: wsId,
      model: null,
      capabilities: "test",
      budgetMonthlyUsd: 100,
    });
    const taskId = db.core.tasks.saveTask({
      companyId,
      title: "Purge task",
      description: "test",
      assigneeAgentId: agentId,
      workspaceId: wsId,
      priority: "medium",
      status: "todo",
    });

    const run = db.core.runs.createRun({ companyId, taskId, agentId, workspaceId: wsId, connectorId: "openai-codex" });
    await db.core.runs.appendRunLog(run.id, "stdout", "test log line\n");

    // Finish the run with a very old timestamp
    db.core.runs.finishRun({
      runId: run.id,
      status: "succeeded",
      summary: "done",
      errorMessage: null,
      exitCode: 0,
      signal: null,
      model: null,
      unattributedCost: true,
    });

    // Log should exist before purge
    expect(db.core.runs.readRunLog(run.id)).toContain("test log line");

    // Set retention to 1 day and manually backdate the run's finished_at
    db.core.settings.updateSettings({ logRetentionDays: 1 });
    // Backdate finished_at to 10 days ago
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
    // Direct SQL update for test only
    (db as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).db
      .prepare("update runs set finished_at = ? where id = ?")
      .run(tenDaysAgo, run.id);

    const purged = db.core.settings.purgeExpiredRunLogs();
    expect(purged).toBe(1);

    // Log should be gone after purge
    expect(db.core.runs.readRunLog(run.id)).toBe("");
  });

  it("populates related_agent_id on hire approvals", () => {
    const companyId = db.core.company.saveCompany({
      name: "Agent Approval Co",
      description: "test",
      status: "active",
    });
    const managerId = db.core.agents.saveAgent({
      companyId,
      name: "Manager",
      role: "CEO",
      title: "CEO",
      status: "active",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId: null,
      model: null,
      capabilities: "manage",
      budgetMonthlyUsd: 100,
    });
    const hireId = db.core.agents.saveAgent({
      companyId,
      name: "New Hire",
      role: "IC",
      title: "IC",
      status: "pending_approval",
      reportsTo: managerId,
      connectorId: "openai-codex",
      workspaceId: null,
      model: null,
      capabilities: "code",
      budgetMonthlyUsd: 50,
    });

    const approvalId = db.core.approvals.requestApproval({
      companyId,
      requestedByAgentId: managerId,
      type: "hire_agent",
      payloadSummary: "Hire New Hire",
      impactSummary: "test",
      payloadJson: JSON.stringify({ agentId: hireId }),
    });

    const approval = db.core.approvals.getApprovalRecord(approvalId);
    // related_agent_id should be populated from payloadJson extraction
    expect(approval.relatedAgentId).toBe(hireId);

    // Explicit relatedAgentId param should also work
    const approvalId2 = db.core.approvals.requestApproval({
      companyId,
      requestedByAgentId: managerId,
      relatedAgentId: hireId,
      type: "hire_agent",
      payloadSummary: "Hire New Hire v2",
      impactSummary: "test",
    });

    const approval2 = db.core.approvals.getApprovalRecord(approvalId2);
    expect(approval2.relatedAgentId).toBe(hireId);
  });

});
