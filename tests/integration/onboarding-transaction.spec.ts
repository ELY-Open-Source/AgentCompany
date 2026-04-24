import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { getModels } from "@mariozechner/pi-ai";
import { AppDatabase } from "../../src/main/database";
import { getConnectorDefinition } from "../../src/main/connectors";
import { createOnboardingService } from "../../src/main/onboarding-service";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function markConnectorReady(db: AppDatabase, connectorId: "openai-codex") {
  db.core.connectors.updateConnectorHealth({
    id: connectorId,
    status: "ready",
    authState: "authenticated",
    version: "test",
    lastError: null,
  });
}

function buildBootstrapInput(workspacePath: string, overrides: Partial<Parameters<ReturnType<typeof createOnboardingService>["bootstrapOnboarding"]>[0]> = {}) {
  return {
    companyName: "Atomic Onboarding Co",
    companyDescription: "Verifies onboarding transaction boundaries",
    workspacePath,
    autoApproveHires: true,
    reviewDeliverables: false,
    executionMode: "ai_ceo",
    goalTitle: "Create one atomic company",
    goalDescription: "Every onboarding write commits together.",
    connectorId: "openai-codex" as const,
    connectorModel: "",
    ...overrides,
  };
}

function expectNoOnboardingState(db: AppDatabase) {
  expect(db.projection.snapshot.listSnapshot().companies).toHaveLength(0);
  expect(db.core.settings.getCurrentCompanyId()).toBeNull();
  expect(db.queryAll("select id from agents")).toHaveLength(0);
  expect(db.queryAll("select id from goals")).toHaveLength(0);
  expect(db.queryAll("select id from projects")).toHaveLength(0);
  expect(db.queryAll("select id from tasks")).toHaveLength(0);
  expect(db.queryAll("select id from runs")).toHaveLength(0);
}

describe("onboarding transaction", () => {
  it("rolls back every persisted onboarding row when model validation rejects the selected model", async () => {
    const profileDir = await createTempDir("agentcompany-onboarding-tx-model-");
    const workspaceDir = await createTempDir("agentcompany-onboarding-tx-workspace-");
    const db = new AppDatabase(profileDir);
    db.init();
    markConnectorReady(db, "openai-codex");

    const definition = getConnectorDefinition("openai-codex");
    const disabledModel = getModels(definition.provider as never)[0]?.id;
    if (!disabledModel) {
      throw new Error("openai-codex requires a model for onboarding transaction coverage.");
    }

    const service = createOnboardingService({
      db,
      seedDefaultAutomationRules: () => {},
      publishDomainChanged: () => {},
      createTaskRunForDeferredDispatch: () => ({
        ok: true,
        data: { runId: "run-1", dispatchAfterCommit: () => {} },
      }),
    });

    expect(() => service.bootstrapOnboarding(buildBootstrapInput(workspaceDir, {
      connectorModel: disabledModel,
      connectorPoolSelections: [
        { connectorId: "openai-codex", disabledModels: [{ id: disabledModel, label: disabledModel }] },
      ],
    }))).toThrow(`${definition.label} does not allow model "${disabledModel}".`);

    expectNoOnboardingState(db);
    db.close();
  });

  it("rolls back every persisted onboarding row and skips external side effects when initial run creation fails", async () => {
    const profileDir = await createTempDir("agentcompany-onboarding-tx-run-");
    const workspaceDir = await createTempDir("agentcompany-onboarding-tx-run-workspace-");
    const db = new AppDatabase(profileDir);
    db.init();
    markConnectorReady(db, "openai-codex");

    let publishCount = 0;
    let scanCount = 0;
    const service = createOnboardingService({
      db,
      seedDefaultAutomationRules: () => {},
      publishDomainChanged: () => {
        publishCount += 1;
      },
      scanAndAssignSkills: async () => {
        scanCount += 1;
      },
      createTaskRunForDeferredDispatch: () => ({ ok: false, error: { code: "RUN_CREATE_FAILED", message: "run insert failed" } }),
    });

    expect(() => service.bootstrapOnboarding(buildBootstrapInput(workspaceDir))).toThrow("run insert failed");

    expectNoOnboardingState(db);
    expect(publishCount).toBe(0);
    expect(scanCount).toBe(0);
    db.close();
  });
});
