import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../../src/main/database";
import { createOnboardingService } from "../../src/main/onboarding-service";
import { buildRunPayload } from "../../src/main/orchestration/turn-context";
import { getConnectorDefinition } from "../../src/main/connectors";
import { getModels } from "@mariozechner/pi-ai";

function listProviderModels(provider: string): Array<{ id: string; label: string }> {
  try {
    const models = getModels(provider as never);
    return models.map((model) => ({ id: model.id, label: model.name ?? model.id }));
  } catch {
    return [];
  }
}

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

    const codexDefinition = getConnectorDefinition("openai-codex");
    const enabledModel = listProviderModels(codexDefinition.provider)[0]?.id;
    const disabledModel = listProviderModels(codexDefinition.provider)[1]?.id;

    if (!enabledModel || !disabledModel) {
      throw new Error("openai-codex requires at least two models for this integration test.");
    }

    db.updateConnectorHealth({
      id: "openai-codex",
      status: "ready",
      authState: "authenticated",
      version: "test",
      lastError: null,
    });
    const summary = createBootstrapHarness(db).bootstrapOnboarding({
      companyName: "Model Governance Co",
      companyDescription: "Tests onboarding model governance",
      workspacePath: workspaceDir,
      autoApproveHires: true,
      reviewDeliverables: false,
      executionMode: "ai_ceo",
      goalTitle: "Launch runtime-safe company",
      goalDescription: "Ensure onboarding connector models flow into runtime decisions.",
      connectorId: "openai-codex",
      connectorModel: enabledModel,
      connectorPoolSelections: [
        { connectorId: "openai-codex", disabledModels: [{ id: disabledModel, label: disabledModel }] },
      ],
    });

    if (!summary.leadAgentId) {
      throw new Error("Expected lead agent id from onboarding bootstrap.");
    }

    const agent = db.getAgent(summary.leadAgentId);
    expect(agent.connectorId).toBe("openai-codex");
    expect(agent.model).toBe(enabledModel);
    expect(db.getDisabledModels(summary.companyId, "openai-codex")).toEqual([{ id: disabledModel, label: disabledModel }]);
    expect(db.getCurrentCompanyId()).toBe(summary.companyId);

    const payload = buildKickoffPayload(db, summary);
    expect(payload.model).toBe(enabledModel);
    expect(payload.systemPrompt).not.toBeNull();
    const systemPrompt = payload.systemPrompt ?? "";
    expect(systemPrompt).toContain("Enabled models:");
    expect(systemPrompt).toContain(enabledModel);
    const codexConnectorLine = systemPrompt
      .split("\n")
      .find((line) => line.includes("ChatGPT Plus/Pro (Codex)"));
    expect(codexConnectorLine).toBeDefined();
    expect(codexConnectorLine).not.toContain(`, ${disabledModel},`);
    expect(codexConnectorLine).not.toContain(` ${disabledModel}.`);

    db.close();
  });

  it("excludes disabled pi-ai models from anthropic connector runtime prompt context", async () => {
    const profileDir = await createTempDir("agentcompany-onboarding-compat-");
    const workspaceDir = await createTempDir("agentcompany-onboarding-compat-workspace-");
    const db = new AppDatabase(profileDir);
    db.init();

    const anthropicDefinition = getConnectorDefinition("anthropic");
    const anthropicModels = listProviderModels(anthropicDefinition.provider);
    const enabledModel = anthropicModels[0]?.id;
    const disabledModel = anthropicModels[1]?.id;
    if (!enabledModel || !disabledModel) {
      throw new Error("anthropic provider must expose at least two models from pi-ai.");
    }

    db.updateConnectorHealth({
      id: "anthropic",
      status: "ready",
      authState: "authenticated",
      version: "test",
      lastError: null,
    });
    const summary = createBootstrapHarness(db).bootstrapOnboarding({
      companyName: "Anthropic Governance Co",
      companyDescription: "Tests anthropic model governance",
      workspacePath: workspaceDir,
      autoApproveHires: true,
      reviewDeliverables: false,
      executionMode: "ai_ceo",
      goalTitle: "Launch anthropic company",
      goalDescription: "Ensure anthropic model pools survive onboarding and runtime prompt assembly.",
      connectorId: "anthropic",
      connectorModel: enabledModel,
      connectorPoolSelections: [
        { connectorId: "anthropic", disabledModels: [{ id: disabledModel, label: disabledModel }] },
      ],
    });

    const payload = buildKickoffPayload(db, summary);
    expect(payload.systemPrompt).not.toBeNull();
    const systemPrompt = payload.systemPrompt ?? "";
    expect(systemPrompt).toContain("Enabled models:");
    expect(systemPrompt).toContain(enabledModel);
    const anthropicLine = systemPrompt
      .split("\n")
      .find((line) => line.includes(anthropicDefinition.label));
    expect(anthropicLine).toBeDefined();
    expect(anthropicLine).not.toContain(`, ${disabledModel},`);
    expect(anthropicLine).not.toContain(` ${disabledModel}.`);

    db.close();
  });

  it("stores a null CEO model when onboarding leaves the connector model at default", async () => {
    const profileDir = await createTempDir("agentcompany-onboarding-default-");
    const workspaceDir = await createTempDir("agentcompany-onboarding-default-workspace-");
    const db = new AppDatabase(profileDir);
    db.init();

    db.updateConnectorHealth({
      id: "openai-codex",
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
      connectorId: "openai-codex",
      connectorModel: "",
    });

    if (!summary.leadAgentId) {
      throw new Error("Expected lead agent id from onboarding bootstrap.");
    }

    const agent = db.getAgent(summary.leadAgentId);
    expect(agent.model).toBeNull();

    const payload = buildKickoffPayload(db, summary);
    const defaultModel = getConnectorDefinition("openai-codex").defaultModel;
    expect(payload.model).toBe(defaultModel);

    db.close();
  });

  it("reroutes default runtime selection to the first enabled model when the connector default is disabled", async () => {
    const profileDir = await createTempDir("agentcompany-onboarding-reroute-");
    const workspaceDir = await createTempDir("agentcompany-onboarding-reroute-workspace-");
    const db = new AppDatabase(profileDir);
    db.init();

    const codexDefinition = getConnectorDefinition("openai-codex");
    const defaultModel = codexDefinition.defaultModel;
    const fallbackModel = listProviderModels(codexDefinition.provider).find((model) => model.id !== defaultModel)?.id;

    if (!defaultModel || !fallbackModel) {
      throw new Error("openai-codex requires a default and fallback model for reroute testing.");
    }

    db.updateConnectorHealth({
      id: "openai-codex",
      status: "ready",
      authState: "authenticated",
      version: "test",
      lastError: null,
    });
    const summary = createBootstrapHarness(db).bootstrapOnboarding({
      companyName: "Default Reroute Co",
      companyDescription: "Tests runtime reroute when the connector default is disabled",
      workspacePath: workspaceDir,
      autoApproveHires: true,
      reviewDeliverables: false,
      executionMode: "ai_ceo",
      goalTitle: "Launch rerouted company",
      goalDescription: "Ensure runtime picks the first enabled model when connector default is disabled.",
      connectorId: "openai-codex",
      connectorModel: "",
      connectorPoolSelections: [
        { connectorId: "openai-codex", disabledModels: [{ id: defaultModel, label: defaultModel }] },
      ],
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

    const codexDefinition = getConnectorDefinition("openai-codex");
    const disabledModel = listProviderModels(codexDefinition.provider)[0]?.id;

    if (!disabledModel) {
      throw new Error("openai-codex requires a model to validate onboarding rejection.");
    }

    db.updateConnectorHealth({
      id: "openai-codex",
      status: "ready",
      authState: "authenticated",
      version: "test",
      lastError: null,
    });
    expect(() => createBootstrapHarness(db).bootstrapOnboarding({
      companyName: "Rejected Model Co",
      companyDescription: "Tests invalid onboarding model rejection",
      workspacePath: workspaceDir,
      autoApproveHires: true,
      reviewDeliverables: false,
      executionMode: "ai_ceo",
      goalTitle: "Reject disabled model bootstrap",
      goalDescription: "Invalid explicit models should fail before the CEO is created.",
      connectorId: "openai-codex",
      connectorModel: disabledModel,
      connectorPoolSelections: [
        { connectorId: "openai-codex", disabledModels: [{ id: disabledModel, label: disabledModel }] },
      ],
    })).toThrow(`${codexDefinition.label} does not allow model "${disabledModel}".`);

    db.close();
  });
});
