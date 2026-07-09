import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { BrowserWindow } from "electron";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { isAutonomousPaused, startTaskQueueWorker } from "../../src/main/app/task-queue-worker";

const fakeWindow = {
  isDestroyed: () => false,
  webContents: { send: () => undefined, isDestroyed: () => false },
} as unknown as BrowserWindow;

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const poll = () => {
      if (predicate()) return resolve(true);
      if (Date.now() - startedAt > timeoutMs) return resolve(false);
      setTimeout(poll, 20);
    };
    poll();
  });
}

describe("global autonomous pause", () => {
  test("the handbrake parks the queue worker and resuming releases it", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-pause-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";
    let runId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "OrbitOps", employeeName: "Yang", mission: "m", goal: "g" });
      const providerId = (connection.db.prepare("select id from providers where org_id = ? limit 1").get(orgId) as { id: string }).id;
      const agentId = organization.createAgent({
        orgId, name: "Ada", role: "Engineer", department: "Engineering",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 1000, managerAgentId: null,
      });
      const taskId = organization.createTask({
        orgId, title: "Queued work", description: "Waits for the engine.", status: "backlog",
        assigneeAgentId: agentId, risk: "low", projectId: null, goalId: null, workspaceId: null,
        priority: "normal", requiresFilesystem: false,
      });
      const serviceIdentityId = (connection.db.prepare("select id from service_identities where org_id = ? and agent_id = ?")
        .get(orgId, agentId) as { id: string }).id;
      runId = `run_pause_${randomUUID().slice(0, 8)}`;
      connection.db.prepare(`
        insert into task_runs(
          id, org_id, task_id, agent_id, provider_id, provider_request_id,
          execution_context_id, service_identity_id, workspace_mount_json, secret_scope_json,
          trigger, state, created_at, started_at, completed_at, error_message
        ) values (?, ?, ?, ?, ?, null, ?, ?, '[]', '{}', 'heartbeat', 'queued', ?, null, null, null)
      `).run(runId, orgId, taskId, agentId, providerId, `ctx_${runId}`, serviceIdentityId, new Date().toISOString());
      organization.setAutonomousPaused(true);
    });

    expect(isAutonomousPaused(connection)).toBe(true);
    expect(snapshot.load().autonomousPaused).toBe(true);

    const runState = () =>
      (connection.db.prepare("select state from task_runs where id = ?").get(runId) as { state: string }).state;

    const stop = startTaskQueueWorker({ connection, mainWindow: fakeWindow, intervalMs: 10 });
    try {
      // Paused: many ticks pass and the queued run is never claimed.
      const claimedWhilePaused = await waitFor(() => runState() !== "queued", 150);
      expect(claimedWhilePaused).toBe(false);

      // Resume: the very next ticks claim it (execution then fails on the
      // unconfigured provider, which is fine - leaving "queued" proves the
      // engine moved).
      connection.transaction(() => organization.setAutonomousPaused(false));
      expect(snapshot.load().autonomousPaused).toBe(false);
      const claimedAfterResume = await waitFor(() => runState() !== "queued", 2_000);
      expect(claimedAfterResume).toBe(true);
    } finally {
      stop();
    }
    connection.close();
  });
});
