import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import type { DesktopResult } from "@shared/contracts";
import { IPC_CHANNELS } from "@shared/contracts";
import { AppDatabase } from "../../src/main/database";
import { registerCoreAdminHandlers } from "../../src/main/ipc-core-admin-handlers";
import { createThreadIntegration } from "../../src/main/thread-integration";

type IpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => Promise<DesktopResult<unknown>> | DesktopResult<unknown>;

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("company mode switching", () => {
  it("clears cofounder review artifacts when switching back to AI CEO", async () => {
    const profileDir = await createTempDir("agentcompany-mode-switch-");
    const db = new AppDatabase(profileDir);
    db.init();

    db.connectorsCrud.updateConnectorHealth({
      id: "openai-codex",
      status: "ready",
      authState: "authenticated",
      version: "test",
      lastError: null,
    });

    const companyId = db.company.saveCompany({
      name: "Mode Switch Co",
      description: "Execution mode cleanup",
      status: "active",
      executionMode: "ai_cofounder",
      autoApproveHires: false,
      reviewDeliverables: true,
    });
    const workspaceId = db.workspacesMod.saveWorkspace({
      companyId,
      name: "Primary",
      localPath: profileDir,
      repoUrl: "",
      repoRef: "",
      isPrimary: true,
    });
    const ceoId = db.agents.saveAgent({
      companyId,
      name: "CEO",
      role: "CEO",
      title: "Chief Executive Officer",
      status: "active",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId,
      model: null,
      capabilities: "Lead the company",
      budgetMonthlyUsd: 250,
    });
    const engineerId = db.agents.saveAgent({
      companyId,
      name: "Engineer",
      role: "Engineer",
      title: "Lead Engineer",
      status: "active",
      reportsTo: ceoId,
      connectorId: "openai-codex",
      workspaceId,
      model: null,
      capabilities: "Ship features",
      budgetMonthlyUsd: 180,
      department: "engineering",
    });
    const taskId = db.tasks.saveTask({
      companyId,
      title: "Ship feature",
      description: "Waits for cofounder review.",
      assigneeAgentId: engineerId,
      workspaceId,
      priority: "high",
      status: "in_progress",
    });

    const threadIntegration = createThreadIntegration({
      db,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });

    threadIntegration.onTaskCreated(taskId, companyId);
    threadIntegration.onRunFinished("run-1", taskId, engineerId, companyId, "succeeded", null);
    db.tasks.setTaskRequiresUserReview(taskId, true);
    const approvalId = db.approvalsMod.requestApproval({
      companyId,
      relatedTaskId: taskId,
      requestedByAgentId: engineerId,
      type: "deliverable_review",
      payloadSummary: "Review deliverable",
      impactSummary: "Needs review",
      payloadJson: "{}",
    });
    threadIntegration.onApprovalCreated(approvalId, companyId, taskId, "deliverable_review", "Review deliverable");

    expect(db.threads.listThreadWaitStates(companyId).length).toBeGreaterThan(0);
    expect(db.entityCrud.getTask(taskId).requiresUserReview).toBe(true);
    expect(db.approvalsMod.getApprovalRecord(approvalId).state).toBe("pending");

    const handlers = new Map<string, IpcHandler>();
    registerCoreAdminHandlers({
      registerHandle: (channel, handler) => {
        handlers.set(channel, handler);
      },
      db,
      ensureCompanyExists: (id) => (db.settings.hasCompany(id) ? null : { ok: false, error: { code: "COMPANY_NOT_FOUND", message: "missing" } }),
      publishDomainChanged: vi.fn(),
      handleApprovalResolved: (resolvedApprovalId, resolvedCompanyId, decision) => {
        threadIntegration.onApprovalResolved(resolvedApprovalId, resolvedCompanyId, decision);
      },
      checkConnector: vi.fn(),
      openGenericTerminal: vi.fn(),
    });

    const saveCompany = handlers.get(IPC_CHANNELS.saveCompany);
    if (!saveCompany) {
      throw new Error("saveCompany handler was not registered.");
    }

    const result = await saveCompany(null as unknown as IpcMainInvokeEvent, {
      id: companyId,
      name: "Mode Switch Co",
      description: "Execution mode cleanup",
      status: "active",
      autoApproveHires: true,
      reviewDeliverables: false,
      executionMode: "ai_ceo",
    }) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(db.company.getCompanyExecutionMode(companyId)).toBe("ai_ceo");
    expect(db.threads.listThreadWaitStates(companyId)).toHaveLength(0);
    expect(db.entityCrud.getTask(taskId).requiresUserReview).toBe(false);
    expect(db.approvalsMod.getApprovalRecord(approvalId).state).toBe("approved");

    db.close();
  });
});
