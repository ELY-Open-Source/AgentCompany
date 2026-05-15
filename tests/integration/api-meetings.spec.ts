import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentToken, initializeAgentTokenSigningKey } from "../../src/main/agent-auth";
import { createApiServer } from "../../src/main/api-server";
import { AppDatabase } from "../../src/main/database";
import { createTestApiServerCallbacks } from "../support/api-server-callbacks";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createHarness() {
  const profileDir = await createTempDir("agentcompany-api-meetings-");
  initializeAgentTokenSigningKey(profileDir);
  const db = new AppDatabase(profileDir);
  db.init();

  const companyId = db.core.company.saveCompany({ name: "Meeting Co", description: "Meeting API test", status: "active" });
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
    name: "Mira",
    role: "CEO",
    title: "Meeting owner",
    status: "active",
    reportsTo: null,
    connectorId: "openai-codex",
    workspaceId,
    model: null,
    capabilities: "Run meetings",
    budgetMonthlyUsd: 100,
  });
  const participantAgentId = db.core.agents.saveAgent({
    companyId,
    name: "Niko",
    role: "Engineer",
    title: "Participant",
    status: "active",
    reportsTo: agentId,
    connectorId: "openai-codex",
    workspaceId,
    model: null,
    capabilities: "Join meetings",
    budgetMonthlyUsd: 100,
  });
  const taskId = db.core.tasks.saveTask({
    companyId,
    title: "Keep meeting PATCH stable",
    description: "Protect existing meeting fields.",
    assigneeAgentId: agentId,
    workspaceId,
    priority: "high",
    status: "todo",
  });
  const run = db.core.runs.createRun({ companyId, taskId, agentId, workspaceId, connectorId: "openai-codex" });
  const token = createAgentToken(agentId, companyId, run.id);
  const server = createApiServer(db, createTestApiServerCallbacks());
  const port = await server.start();

  return {
    db,
    server,
    companyId,
    agentId,
    participantAgentId,
    baseUrl: `http://127.0.0.1:${port}`,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Agent-Company-Run-Id": run.id,
      "Content-Type": "application/json",
    },
  };
}

describe("meeting API", () => {
  it("PATCH preserves existing meeting fields when only partial fields are sent", async () => {
    const harness = await createHarness();
    try {
      const participantAgentIds = JSON.stringify([harness.participantAgentId]);
      const agendaJson = JSON.stringify([{ title: "Roadmap", owner: harness.agentId }]);
      const decisionsJson = JSON.stringify([{ title: "Keep current plan" }]);
      const actionItemsJson = JSON.stringify([{ title: "Ship patch", assigneeAgentId: harness.participantAgentId }]);
      const meetingId = harness.db.core.knowledge.saveMeeting({
        companyId: harness.companyId,
        type: "department_sync",
        title: "Planning Sync",
        organizerAgentId: harness.agentId,
        participantAgentIds,
        scheduledAt: "2026-05-15T10:00:00.000Z",
        durationMinutes: 45,
        agendaJson,
        notesJson: JSON.stringify([{ text: "Original note" }]),
        decisionsJson,
        actionItemsJson,
        status: "scheduled",
      });

      const response = await fetch(`${harness.baseUrl}/api/meetings/${meetingId}`, {
        method: "PATCH",
        headers: harness.headers,
        body: JSON.stringify({
          notesJson: JSON.stringify([{ text: "Updated note" }]),
          status: "completed",
        }),
      });

      expect(response.status).toBe(200);
      const updated = harness.db.core.knowledge.getMeeting(meetingId, harness.companyId);
      expect(updated).toMatchObject({
        type: "department_sync",
        title: "Planning Sync",
        organizerAgentId: harness.agentId,
        participantAgentIds,
        scheduledAt: "2026-05-15T10:00:00.000Z",
        durationMinutes: 45,
        agendaJson,
        decisionsJson,
        actionItemsJson,
        status: "completed",
      });
      expect(updated?.notesJson).toBe(JSON.stringify([{ text: "Updated note" }]));
    } finally {
      harness.server.stop();
      harness.db.close();
    }
  });
});
