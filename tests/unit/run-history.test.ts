import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { runHistory } from "../../src/main/services/run-history";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS } from "../../src/shared/domain";

describe("run history", () => {
  test("pages back past the snapshot's recent runs to the very first", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-run-history-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    let taskId = "";
    let agentId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Yang", mission: "m", goal: "g" });
      agentId = organization.createAgent({ orgId, name: "Ada", role: "Engineer", department: "Engineering", modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: null });
      taskId = organization.createTask({
        orgId, title: "Work", description: "d", status: TASK_STATUS.BACKLOG, assigneeAgentId: agentId, risk: RISK_LEVEL.LOW,
        projectId: null, goalId: null, workspaceId: null, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: false,
      });
      // Every run shares one instant, so only insertion order can page them correctly.
      const insert = connection.db.prepare("insert into task_runs(id, org_id, task_id, agent_id, trigger, state, created_at) values (?, ?, ?, ?, 'manual', 'completed', '2026-04-01T00:00:00.000Z')");
      for (let index = 0; index < 230; index += 1) insert.run(`run_${String(index).padStart(3, "0")}`, orgId, taskId, agentId);
    });
    const recent = new SnapshotService(connection.db).load().taskRuns;
    expect(recent).toHaveLength(200);
    expect(recent[0].id).toBe("run_030");
    const older = runHistory(connection.db, orgId, recent[0].id, { limit: 20 });
    expect(older.runs.map((run) => run.id)).toEqual(Array.from({ length: 20 }, (_, index) => `run_${String(index + 10).padStart(3, "0")}`));
    expect(older.hasMore).toBe(true);
    const oldest = runHistory(connection.db, orgId, older.runs[0].id, { limit: 20 });
    expect(oldest.runs.map((run) => run.id)).toEqual(Array.from({ length: 10 }, (_, index) => `run_${String(index).padStart(3, "0")}`));
    expect(oldest.hasMore).toBe(false);
    expect(() => runHistory(connection.db, orgId, "run_missing", { limit: 20 })).toThrow("The oldest loaded run was not found.");
    // The loaded range refreshes in one query from its oldest run up to the cursor.
    const range = runHistory(connection.db, orgId, recent[0].id, { from: oldest.oldest! });
    expect([range.runs.length, range.runs[0].id, range.runs.at(-1)!.id, range.hasMore]).toEqual([30, "run_000", "run_029", false]);
    // The pinned position holds after its run is deleted, and the range still says whether older runs exist.
    connection.db.prepare("delete from task_runs where id in ('run_000', 'run_001')").run();
    expect(runHistory(connection.db, orgId, recent[0].id, { from: older.oldest! })).toMatchObject({ hasMore: true });
    expect(runHistory(connection.db, orgId, recent[0].id, { from: oldest.oldest! }).runs[0].id).toBe("run_002");
    // With nothing loaded, the newest runs come first.
    expect(runHistory(connection.db, orgId, null, { limit: 2 }).runs.map((run) => run.id)).toEqual(["run_228", "run_229"]);
    connection.close();
  });
});
