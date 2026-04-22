import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { AppDatabase } from "../../src/main/database";
import { buildTaskPrompt } from "../../src/main/prompt-builder/index";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("skill-aware capability registry", () => {
  it("autoAssignTask prefers an agent whose assigned skill matches the task, even when capability text is generic", async () => {
    const profileDir = await createTempDir("agentcompany-skill-assign-");
    const db = new AppDatabase(profileDir);
    db.init();

    db.core.connectors.updateConnectorHealth({
      id: "openai-codex",
      status: "ready",
      authState: "authenticated",
      version: "test",
      lastError: null,
    });

    const companyId = db.core.company.saveCompany({
      name: "Skill Match Co",
      description: "Tests skill-aware assignment",
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

    db.core.agents.saveAgent({
      companyId,
      name: "Generic Engineer",
      role: "Engineer",
      title: "Engineer",
      status: "active",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId,
      model: null,
      capabilities: "General software delivery",
      budgetMonthlyUsd: 200,
    });
    const styledEngineerId = db.core.agents.saveAgent({
      companyId,
      name: "Frontend Specialist",
      role: "Engineer",
      title: "Frontend Specialist",
      status: "active",
      reportsTo: null,
      connectorId: "openai-codex",
      workspaceId,
      model: null,
      capabilities: "General software delivery",
      budgetMonthlyUsd: 200,
    });

    const skillId = randomUUID();
    const now = new Date().toISOString();
    db.core.skills.upsertCompanySkill({
      id: skillId,
      companyId,
      key: "frontend/react-ui",
      slug: "react-ui",
      name: "React UI",
      description: "Build React components with hooks, Tailwind, and accessible layouts",
      sourceType: "local_path",
      sourceLocator: null,
      sourceRef: null,
      trustLevel: "markdown_only",
      compatibility: "compatible",
      fileInventory: "[]",
      metadata: null,
      createdAt: now,
      updatedAt: now,
    });
    db.core.skills.assignSkillToAgent(styledEngineerId, skillId);

    const taskId = db.core.tasks.saveTask({
      companyId,
      title: "Build React dashboard widget",
      description: "Create an accessible React component with hooks and Tailwind styling.",
      workspaceId,
      priority: "high",
      status: "todo",
    });

    const assignedId = db.core.tasks.autoAssignTask(taskId, companyId);
    expect(assignedId).toBe(styledEngineerId);

    db.close();
  });

  it("injects the company capability registry into the task prompt", async () => {
    const profileDir = await createTempDir("agentcompany-capability-prompt-");
    const db = new AppDatabase(profileDir);
    db.init();

    db.core.connectors.updateConnectorHealth({
      id: "openai-codex",
      status: "ready",
      authState: "authenticated",
      version: "test",
      lastError: null,
    });

    const companyId = db.core.company.saveCompany({
      name: "Registry Co",
      description: "Tests capability registry prompt injection",
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

    const skillId = randomUUID();
    const now = new Date().toISOString();
    db.core.skills.upsertCompanySkill({
      id: skillId,
      companyId,
      key: "frontend/react-ui",
      slug: "react-ui",
      name: "React UI",
      description: "Use when building React interfaces",
      sourceType: "local_path",
      sourceLocator: null,
      sourceRef: null,
      trustLevel: "markdown_only",
      compatibility: "compatible",
      fileInventory: "[]",
      metadata: null,
      createdAt: now,
      updatedAt: now,
    });

    const snapshot = db.projection.snapshot.listSnapshot();
    const prompt = buildTaskPrompt({
      agent: db.core.entity.getAgent(agentId),
      apiUrl: "http://127.0.0.1:3210",
      apiKey: "token",
      runId: "run-1",
      task: null,
      companyName: "Registry Co",
      companyDescription: "Tests capability registry prompt injection",
      goals: [],
      projects: [],
      directReports: [],
      chainOfCommand: [],
      assignedTasks: [],
      allAgents: snapshot.agents.filter((entry) => entry.companyId === companyId),
      pendingApprovals: [],
      tasksAwaitingReview: [],
      wakeReason: "assignment",
      allTasks: [],
      recentComments: [],
      socialAccounts: [],
      allConnectors: snapshot.connectors
        .filter((connector) => connector.id === "openai-codex")
        .map((connector) => ({ id: connector.id, label: connector.label, status: connector.status, enabledModels: ["gpt-5.4"] })),
      companySkillCatalog: db.core.skills.listCompanySkills(companyId).map((skill) => ({
        name: skill.name,
        slug: skill.slug,
        description: skill.description,
      })),
      companyWorkspaces: snapshot.workspaces
        .filter((workspace) => workspace.companyId === companyId)
        .map((workspace) => ({ name: workspace.name, localPath: workspace.localPath })),
      companyDocuments: [],
      skills: [
        {
          name: "react-standards",
          description: "Use when building React UI with hooks and Tailwind.",
          filePath: "/tmp/react-standards/SKILL.md",
          baseDir: "/tmp/react-standards",
        },
      ],
    });

    expect(prompt).toContain("# Company Capability Registry");
    expect(prompt).toContain("React UI (`react-ui`)");
    expect(prompt).toContain("Primary:");
    expect(prompt).toContain("Ready Connectors");
    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("<name>react-standards</name>");

    db.close();
  });
});
