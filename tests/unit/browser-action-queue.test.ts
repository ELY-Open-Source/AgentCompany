import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../../src/main/database";
import { createBrowserActionService } from "../../src/main/browser-action-service";
import { recoverScheduledPosts } from "../../src/main/bootstrap/recover-scheduled-posts";
import type { BrowserManager } from "../../src/main/browser-manager";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function nextTick(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function seedBrowserAction(db: AppDatabase, profileDir: string, input?: {
  payloadJson?: string;
  approvalId?: string | null;
}): { companyId: string; actionId: string } {
  const companyId = db.core.company.saveCompany({
    name: "Browser Queue Co",
    description: "Queue contract test",
    status: "active",
  });
  const workspaceId = db.core.workspaces.saveWorkspace({
    companyId,
    name: "Primary",
    localPath: profileDir,
    repoUrl: "",
    repoRef: "",
    isPrimary: true,
  });
  const agentId = db.core.agents.saveAgent({
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
  const socialAccountId = db.core.social.saveSocialAccount({
    companyId,
    platform: "twitter",
    accountName: "agentcompany",
    status: "ready",
    requireApproval: false,
  });
  const actionId = db.core.social.saveBrowserAction({
    companyId,
    socialAccountId,
    agentId,
    actionType: "post",
    payloadJson: input?.payloadJson ?? JSON.stringify({ content: "hello" }),
    status: "queued",
    approvalId: input?.approvalId ?? null,
  });
  return { companyId, actionId };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("browser action queue", () => {
  it("marks queued actions failed and records activity when dispatch fails before execution", async () => {
    const profileDir = await createTempDir("agentcompany-browser-queue-");
    const db = new AppDatabase(profileDir);
    db.init();
    const { companyId, actionId } = seedBrowserAction(db, profileDir, {
      approvalId: "missing-approval",
    });
    let published = 0;
    const service = createBrowserActionService({
      db,
      browserManagerRef: { current: null as BrowserManager | null },
      publishDomainChanged: () => { published += 1; },
    });

    service.queueBrowserActionExecution(actionId, companyId);
    await nextTick();

    const action = db.core.social.getBrowserAction(actionId, companyId);
    expect(action?.status).toBe("failed");
    expect(action?.errorMessage).toContain("missing-approval");
    const activity = db.projection.snapshot.listSnapshot({ companyId }).activity;
    expect(activity.some((entry) => entry.action === "browser.action_dispatch_failed" && entry.entityId === actionId)).toBe(true);
    expect(published).toBeGreaterThan(0);
    db.close();
  });

  it("startup recovery schedules queued browser actions through the queue wrapper", async () => {
    const profileDir = await createTempDir("agentcompany-browser-recovery-");
    const db = new AppDatabase(profileDir);
    db.init();
    const scheduledAt = new Date(Date.now() + 40).toISOString();
    const { companyId, actionId } = seedBrowserAction(db, profileDir, {
      payloadJson: JSON.stringify({ content: "scheduled", scheduledAt }),
    });
    const calls: Array<{ actionId: string; companyId: string }> = [];

    const timers = recoverScheduledPosts({
      db,
      logger: { info: () => {}, warn: () => {} },
      isQuittingRef: { current: false },
      getBrowserActionService: () => ({
        queueBrowserActionExecution: (queuedActionId, queuedCompanyId) => {
          calls.push({ actionId: queuedActionId, companyId: queuedCompanyId });
        },
      }),
    });

    await delay(80);
    for (const timer of timers) clearTimeout(timer);

    expect(calls).toEqual([{ actionId, companyId }]);
    db.close();
  });
});
