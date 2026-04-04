import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../../src/main/database";
import { createOnboardingService } from "../../src/main/onboarding-service";
import { buildRunPayload } from "../../src/main/orchestration/turn-context";
import { getConnectorDefinition } from "../../src/main/connectors";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createNoopLogger() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function createBootstrapHarness(db: AppDatabase) {
  const noop = () => {};
  return createOnboardingService({
    db,
    seedDefaultAutomationRules: noop,
    publishDomainChanged: noop,
    queueTaskRun: () => ({ ok: true, data: "run-1" }),
  });
}

function buildKickoffPayload(db: AppDatabase, summary: { companyId: string; leadAgentId: string | null; taskId: string | null; workspaceId: string | null }) {
  if (!summary.leadAgentId || !summary.taskId) {
    throw new Error("Missing lead agent or task in onboarding summary.");
  }

  const agent = db.getAgent(summary.leadAgentId);
  const task = db.getTask(summary.taskId);
  const connector = db.getConnector(agent.connectorId);
  const workspace = summary.workspaceId ? db.getWorkspace(summary.workspaceId) : null;
  const company = db.listSnapshot().companies.find((entry) => entry.id === summary.companyId);

  if (!company) {
    throw new Error(`Company ${summary.companyId} not found in snapshot.`);
  }

  return buildRunPayload({
    runId: "run-1",
    companyId: summary.companyId,
    agent,
    task,
    connector,
    workspace,
    workspaceMode: "exclusive",
    companyName: company.name,
    companyDescription: company.description,
    snapshot: db.listSnapshot(),
    trigger: "bootstrap",
  }, {
    db,
    logger: createNoopLogger(),
    getApiPort: () => 3210,
    createRunToken: () => "test-token",
    listRuntimeSkillEntries: () => [],
  });
}

describe("onboarding model pool integration", () => {
  it("persists an explicit CEO model and excludes disabled native models from runtime prompt context", async () => {
    const profileDir = await createTempDir("agentcompany-onboarding-models-");
    const workspaceDir = await createTempDir("agentcompany-onboarding-workspace-");
    const db = new AppDatabase(profileDir);
    db.init();

    const codexDefinition = getConnectorDefinition("codex_local");
    const enabledModel = codexDefinition.module.models?.[0]?.id;
    const disabledModel = codexDefinition.module.models?.[1]?.id;

    if (!enabledModel || !disabledModel) {
      throw new Error("codex_local requires at least two models for this integration test.");
    }

    db.updateConnectorHealth({
      id: "codex_local",
      status: "ready",
      authState: "authenticated",
      version: "test",
      lastError: null,
    });
    db.setDisabledModels("codex_local", [{ id: disabledModel, label: disabledModel }]);

    const summary = createBootstrapHarness(db).bootstrapOnboarding({
      companyName: "Model Governance Co",
      companyDescription: "Tests onboarding model governance",
      workspacePath: workspaceDir,
      autoApproveHires: true,
      reviewDeliverables: false,
      executionMode: "ai_ceo",
      goalTitle: "Launch runtime-safe company",
      goalDescription: "Ensure onboarding connector models flow into runtime decisions.",
      connectorId: "codex_local",
      connectorModel: enabledModel,
    });

    if (!summary.leadAgentId) {
      throw new Error("Expected lead agent id from onboarding bootstrap.");
    }

    const agent = db.getAgent(summary.leadAgentId);
    expect(agent.connectorId).toBe("codex_local");
    expect(agent.model).toBe(enabledModel);
    expect(db.getDisabledModels("codex_local")).toEqual([{ id: disabledModel, label: disabledModel }]);
    expect(db.getCurrentCompanyId()).toBe(summary.companyId);

    const payload = buildKickoffPayload(db, summary);
    expect(payload.model).toBe(enabledModel);
    expect(payload.systemPrompt).not.toBeNull();
    const systemPrompt = payload.systemPrompt ?? "";
    expect(systemPrompt).toContain("Enabled models:");
    expect(systemPrompt).toContain(enabledModel);
    const codexConnectorLine = systemPrompt
      .split("\n")
      .find((line) => line.includes("**Codex**"));
    expect(codexConnectorLine).toBeDefined();
    expect(codexConnectorLine).not.toContain(`, ${disabledModel},`);
    expect(codexConnectorLine).not.toContain(` ${disabledModel}.`);

    db.close();
  });

  it("uses compat connector csv models minus disabled entries in runtime prompt context", async () => {
    const profileDir = await createTempDir("agentcompany-onboarding-compat-");
    const workspaceDir = await createTempDir("agentcompany-onboarding-compat-workspace-");
    const db = new AppDatabase(profileDir);
    db.init();

    db.saveConnector({
      id: "claude_compatible",
      command: "claude",
      model: "model-alpha,model-beta,model-gamma",
      envBindingText: "",
      notes: "Custom provider",
    });
    db.updateConnectorHealth({
      id: "claude_compatible",
      status: "ready",
      authState: "authenticated",
      version: "test",
      lastError: null,
    });
    db.setDisabledModels("claude_compatible", [{ id: "model-beta", label: "model-beta" }]);

    const summary = createBootstrapHarness(db).bootstrapOnboarding({
      companyName: "Compat Governance Co",
      companyDescription: "Tests compat model governance",
      workspacePath: workspaceDir,
      autoApproveHires: true,
      reviewDeliverables: false,
      executionMode: "ai_ceo",
      goalTitle: "Launch compat company",
      goalDescription: "Ensure compat model pools survive onboarding and runtime prompt assembly.",
      connectorId: "claude_compatible",
      connectorModel: "model-alpha",
    });

    const payload = buildKickoffPayload(db, summary);
    expect(payload.systemPrompt).not.toBeNull();
    const systemPrompt = payload.systemPrompt ?? "";
    expect(systemPrompt).toContain("Enabled models: model-alpha, model-gamma.");
    expect(systemPrompt).not.toContain("model-beta");

    db.close();
  });

  it("stores a null CEO model when onboarding leaves the connector model at default", async () => {
    const profileDir = await createTempDir("agentcompany-onboarding-default-");
    const workspaceDir = await createTempDir("agentcompany-onboarding-default-workspace-");
    const db = new AppDatabase(profileDir);
    db.init();

    db.updateConnectorHealth({
      id: "codex_local",
      status: "ready",
      authState: "authenticated",
      version: "test",
      lastError: null,
    });

    const summary = createBootstrapHarness(db).bootstrapOnboarding({
      companyName: "Default Model Co",
      companyDescription: "Tests default connector model behavior",
      workspacePath: workspaceDir,
      autoApproveHires: true,
      reviewDeliverables: false,
      executionMode: "ai_ceo",
      goalTitle: "Launch default-mode company",
      goalDescription: "Leave the CEO model unset so runtime falls back to connector defaults.",
      connectorId: "codex_local",
      connectorModel: "",
    });

    if (!summary.leadAgentId) {
      throw new Error("Expected lead agent id from onboarding bootstrap.");
    }

    const agent = db.getAgent(summary.leadAgentId);
    expect(agent.model).toBeNull();

    const payload = buildKickoffPayload(db, summary);
    const defaultModel = getConnectorDefinition("codex_local").defaultModel;
    expect(payload.model).toBe(defaultModel);

    db.close();
  });

  it("reroutes default runtime selection to the first enabled model when the connector default is disabled", async () => {
    const profileDir = await createTempDir("agentcompany-onboarding-reroute-");
    const workspaceDir = await createTempDir("agentcompany-onboarding-reroute-workspace-");
    const db = new AppDatabase(profileDir);
    db.init();

    const codexDefinition = getConnectorDefinition("codex_local");
    const defaultModel = codexDefinition.defaultModel;
    const fallbackModel = codexDefinition.module.models?.find((model) => model.id !== defaultModel)?.id;

    if (!defaultModel || !fallbackModel) {
      throw new Error("codex_local requires a default and fallback model for reroute testing.");
    }

    db.updateConnectorHealth({
      id: "codex_local",
      status: "ready",
      authState: "authenticated",
      version: "test",
      lastError: null,
    });
    db.setDisabledModels("codex_local", [{ id: defaultModel, label: defaultModel }]);

    const summary = createBootstrapHarness(db).bootstrapOnboarding({
      companyName: "Default Reroute Co",
      companyDescription: "Tests runtime reroute when the connector default is disabled",
      workspacePath: workspaceDir,
      autoApproveHires: true,
      reviewDeliverables: false,
      executionMode: "ai_ceo",
      goalTitle: "Launch rerouted company",
      goalDescription: "Ensure runtime picks the first enabled model when connector default is disabled.",
      connectorId: "codex_local",
      connectorModel: "",
    });

    const payload = buildKickoffPayload(db, summary);
    expect(payload.model).toBe(fallbackModel);

    db.close();
  });

  it("rejects an explicit onboarding model that is disabled for the selected connector", async () => {
    const profileDir = await createTempDir("agentcompany-onboarding-reject-");
    const workspaceDir = await createTempDir("agentcompany-onboarding-reject-workspace-");
    const db = new AppDatabase(profileDir);
    db.init();

    const codexDefinition = getConnectorDefinition("codex_local");
    const disabledModel = codexDefinition.module.models?.[0]?.id;

    if (!disabledModel) {
      throw new Error("codex_local requires a model to validate onboarding rejection.");
    }

    db.updateConnectorHealth({
      id: "codex_local",
      status: "ready",
      authState: "authenticated",
      version: "test",
      lastError: null,
    });
    db.setDisabledModels("codex_local", [{ id: disabledModel, label: disabledModel }]);

    expect(() => createBootstrapHarness(db).bootstrapOnboarding({
      companyName: "Rejected Model Co",
      companyDescription: "Tests invalid onboarding model rejection",
      workspacePath: workspaceDir,
      autoApproveHires: true,
      reviewDeliverables: false,
      executionMode: "ai_ceo",
      goalTitle: "Reject disabled model bootstrap",
      goalDescription: "Invalid explicit models should fail before the CEO is created.",
      connectorId: "codex_local",
      connectorModel: disabledModel,
    })).toThrow(`Codex does not allow model "${disabledModel}".`);

    db.close();
  });
});
