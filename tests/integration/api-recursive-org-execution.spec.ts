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
  const profileDir = await createTempDir("agentcompany-recursive-org-");
  initializeAgentTokenSigningKey(profileDir);
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
    name: "Recursive Org Co",
    description: "Tests manager-driven recursive hires",
    status: "active",
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
  const ctoId = db.agents.saveAgent({
    companyId,
    name: "CTO",
    role: "CTO",
    title: "Chief Technology Officer",
    status: "active",
    reportsTo: ceoId,
    connectorId: "openai-codex",
    workspaceId,
    model: null,
    capabilities: "Lead engineering",
    budgetMonthlyUsd: 220,
    department: "engineering",
  });
  const taskId = db.tasks.saveTask({
    companyId,
    title: "Build the org",
    description: "CTO should hire the first IC under engineering.",
    assigneeAgentId: ctoId,
    workspaceId,
    priority: "high",
    status: "in_progress",
  });
  const run = db.runs.createRun({ companyId, taskId, agentId: ctoId, workspaceId, connectorId: "openai-codex" });
  const token = createAgentToken(ctoId, companyId, run.id);
  const server = createApiServer(db, createTestApiServerCallbacks());
  const port = await server.start();

  return {
    db,
    server,
    companyId,
    workspaceId,
    ceoId,
    ctoId,
    baseUrl: `http://127.0.0.1:${port}`,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Agent-Company-Run-Id": run.id,
      "Content-Type": "application/json; charset=utf-8",
    },
  };
}

describe("recursive org execution", () => {
  it("manager can request a hire under themselves and the hierarchy reflects it after approval", async () => {
    const harness = await createHarness();
    try {
      const response = await fetch(`${harness.baseUrl}/api/companies/${harness.companyId}/agents`, {
        method: "POST",
        headers: harness.headers,
        body: JSON.stringify({
          name: "Avery Chen",
          role: "Engineer",
          title: "Frontend Engineer",
          department: "engineering",
          connectorId: "openai-codex",
          workspaceId: harness.workspaceId,
          model: null,
          capabilities: "React, TypeScript, Tailwind, frontend delivery",
          budgetMonthlyUsd: 180,
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json() as { agentId: string; approvalId: string; autoApproved: boolean };
      expect(body.autoApproved).toBe(false);

      const pendingHire = harness.db.entityCrud.getAgent(body.agentId);
      expect(pendingHire.status).toBe("pending_approval");
      expect(pendingHire.reportsTo).toBe(harness.ctoId);

      const approval = harness.db.approvalsMod.getApprovalRecord(body.approvalId);
      expect(approval.type).toBe("hire_agent");
      expect(approval.requestedByAgentId).toBe(harness.ctoId);
      expect(approval.relatedAgentId).toBe(body.agentId);

      harness.db.approvalsMod.decideApproval({
        approvalId: body.approvalId,
        state: "approved",
        decisionNote: "Approved by board",
      });

      const approvedHire = harness.db.entityCrud.getAgent(body.agentId);
      expect(approvedHire.status).toBe("idle");
      expect(harness.db.agents.getDirectReports(harness.ctoId, harness.companyId).map((agent) => agent.id)).toContain(body.agentId);
      expect(harness.db.agents.getDirectReports(harness.ceoId, harness.companyId).map((agent) => agent.id)).not.toContain(body.agentId);
      expect(harness.db.agents.getChainOfCommand(body.agentId).map((agent) => agent.id)).toEqual([harness.ctoId, harness.ceoId]);

      const agentResponse = await fetch(`${harness.baseUrl}/api/agents/${body.agentId}`, {
        headers: harness.headers,
      });
      expect(agentResponse.status).toBe(200);
      const agentBody = await agentResponse.json() as { manager: { id: string } | null };
      expect(agentBody.manager?.id).toBe(harness.ctoId);

      const meResponse = await fetch(`${harness.baseUrl}/api/agents/me`, {
        headers: harness.headers,
      });
      expect(meResponse.status).toBe(200);
      const meBody = await meResponse.json() as { directReports: Array<{ id: string }> };
      expect(meBody.directReports.map((agent) => agent.id)).toContain(body.agentId);
    } finally {
      harness.server.stop();
      harness.db.close();
    }
  });

  it("routes cross-department hires to the relevant department lead when reportsTo is omitted", async () => {
    const harness = await createHarness();
    try {
      const hrId = harness.db.agents.saveAgent({
        companyId: harness.companyId,
        name: "HR Director",
        role: "HR Director",
        title: "Director of People",
        status: "active",
        reportsTo: harness.ceoId,
        connectorId: "openai-codex",
        workspaceId: harness.workspaceId,
        model: null,
        capabilities: "Coordinate staffing",
        budgetMonthlyUsd: 180,
        department: "hr",
      });
      const hrTaskId = harness.db.tasks.saveTask({
        companyId: harness.companyId,
        title: "Fill engineering gap",
        description: "Request a backend engineer for the engineering team.",
        assigneeAgentId: hrId,
        workspaceId: harness.workspaceId,
        priority: "high",
        status: "in_progress",
      });
      const hrRun = harness.db.runs.createRun({
        companyId: harness.companyId,
        taskId: hrTaskId,
        agentId: hrId,
        workspaceId: harness.workspaceId,
        connectorId: "openai-codex",
      });
      const hrToken = createAgentToken(hrId, harness.companyId, hrRun.id);

      const response = await fetch(`${harness.baseUrl}/api/companies/${harness.companyId}/agents`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${hrToken}`,
          "X-Agent-Company-Run-Id": hrRun.id,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          name: "Avery Chen",
          role: "Backend Engineer",
          title: "Backend Engineer Golang",
          department: "engineering",
          connectorId: "openai-codex",
          workspaceId: harness.workspaceId,
          model: null,
          capabilities: "Go, PostgreSQL, distributed systems",
          budgetMonthlyUsd: 180,
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json() as { agentId: string };
      const pendingHire = harness.db.entityCrud.getAgent(body.agentId);
      expect(pendingHire.department).toBe("engineering");
      expect(pendingHire.reportsTo).toBe(harness.ctoId);
    } finally {
      harness.server.stop();
      harness.db.close();
    }
  });

  it("rejects multi-word hire names that only repeat the job title", async () => {
    const harness = await createHarness();
    try {
      const response = await fetch(`${harness.baseUrl}/api/companies/${harness.companyId}/agents`, {
        method: "POST",
        headers: harness.headers,
        body: JSON.stringify({
          name: "Backend Engineer Golang",
          role: "Backend Engineer",
          title: "Backend Engineer Golang",
          department: "engineering",
          connectorId: "openai-codex",
          workspaceId: harness.workspaceId,
          model: null,
          capabilities: "Go, APIs",
          budgetMonthlyUsd: 180,
        }),
      });

      expect(response.status).toBe(422);
      const body = await response.json() as { error: string };
      expect(body.error).toContain("Hire name");
    } finally {
      harness.server.stop();
      harness.db.close();
    }
  });

  it("manager cannot route a hire outside their reporting branch", async () => {
    const harness = await createHarness();
    try {
      const cmoId = harness.db.agents.saveAgent({
        companyId: harness.companyId,
        name: "CMO",
        role: "CMO",
        title: "Chief Marketing Officer",
        status: "active",
        reportsTo: harness.ceoId,
        connectorId: "openai-codex",
        workspaceId: harness.workspaceId,
        model: null,
        capabilities: "Lead marketing",
        budgetMonthlyUsd: 220,
        department: "marketing",
      });

      const response = await fetch(`${harness.baseUrl}/api/companies/${harness.companyId}/agents`, {
        method: "POST",
        headers: harness.headers,
        body: JSON.stringify({
          name: "Misrouted Hire",
          role: "Engineer",
          title: "Misrouted Engineer",
          department: "engineering",
          reportsTo: cmoId,
          connectorId: "openai-codex",
          workspaceId: harness.workspaceId,
          model: null,
          capabilities: "Should not report outside the CTO branch",
          budgetMonthlyUsd: 180,
        }),
      });

      expect(response.status).toBe(422);
      const body = await response.json() as { error: string };
      expect(body.error).toContain("same department");
    } finally {
      harness.server.stop();
      harness.db.close();
    }
  });
});
