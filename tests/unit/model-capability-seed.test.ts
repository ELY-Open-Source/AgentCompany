import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectorId } from "@shared/types";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => "basic_text",
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

import { AppDatabase } from "../../src/main/database";
import { CONNECTORS } from "../../src/main/connector-definitions";
import { resolveModels } from "../../src/main/model-resolver";
import { pickFromCandidates } from "../../src/main/model-dispatch";

describe("model capability seed", () => {
  let tempDir: string;
  let db: AppDatabase;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-model-capabilities-"));
    db = new AppDatabase(tempDir);
    db.init();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("keeps catalog-seeded rows current on existing profiles without overwriting user edits", () => {
    db.core.modelCapabilities.upsertModelCapability({
      provider: "zai",
      modelId: "glm-4.6",
      reasoning: 2,
      coding: 2,
      writing: 2,
      tier: "trivial",
      costPerMtokOut: 99,
    });
    db.core.modelCapabilities.deleteModelCapability("zai", "glm-5.1");

    db.close();
    db = new AppDatabase(tempDir);
    db.init();

    expect(db.core.modelCapabilities.getModelCapability("zai", "glm-5.1")).toMatchObject({
      provider: "zai",
      modelId: "glm-5.1",
      reasoning: 5,
      coding: 4,
      writing: 4,
      tier: "hard",
    });
    expect(db.core.modelCapabilities.getModelCapability("zai", "glm-4.6")).toMatchObject({
      reasoning: 2,
      coding: 2,
      writing: 2,
      tier: "trivial",
      costPerMtokOut: 99,
    });
  });

  it("seeds a capability row for every static connector catalog model", () => {
    const seeded = new Set(
      db.core.modelCapabilities
        .listModelCapabilities()
        .map((entry) => `${entry.provider}::${entry.modelId}`),
    );
    const expected = new Set<string>();

    for (const connector of CONNECTORS) {
      for (const model of resolveModels(connector.provider)) {
        expected.add(`${connector.provider}::${model.id}`);
      }
      if (connector.auth.type !== "local" && connector.defaultModel.trim()) {
        expected.add(`${connector.provider}::${connector.defaultModel}`);
      }
    }

    expect(expected.size).toBeGreaterThan(700);
    for (const key of expected) {
      expect(seeded.has(key), key).toBe(true);
    }
  });

  it("uses the same catalog seed path for hard reasoning picks", () => {
    const winner = pickFromCandidates(
      { domain: "reasoning", requiredTier: "hard" },
      [{ provider: "zai", connectorId: "zai" as ConnectorId, modelId: "glm-5.1" }],
      db.core.modelCapabilities.listModelCapabilities(),
    );

    expect(winner?.modelId).toBe("glm-5.1");
  });
});
