import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDatabase } from "../../src/main/database";

beforeAll(() => {
  process.env.AGENTCOMPANY_ALLOW_INSECURE_VAULT = "true";
});

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => "basic_text",
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

describe("agent hierarchy cycle guard", () => {
  let tempDir: string;
  let db: AppDatabase;
  let companyId: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-hierarchy-"));
    db = new AppDatabase(tempDir);
    db.init();
    companyId = db.company.saveCompany({
      name: "Hierarchy Guard Co",
      description: "Tests reporting relationships.",
      status: "active",
    });
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("rejects direct self-reporting", () => {
    expect(() => saveAgent("agent-self", "agent-self")).toThrow("Agent reporting relationship would create a cycle.");
  });

  it("rejects assigning a manager to one of its descendants", () => {
    saveAgent("ceo", null);
    saveAgent("cto", "ceo");
    saveAgent("engineer", "cto");

    expect(() => saveAgent("ceo", "engineer")).toThrow("Agent reporting relationship would create a cycle.");
  });

  it("allows acyclic hierarchy updates", () => {
    saveAgent("ceo", null);
    saveAgent("cto", "ceo");
    saveAgent("engineer", "cto");

    saveAgent("engineer", "ceo");

    expect(db.entityCrud.getAgent("engineer").reportsTo).toBe("ceo");
  });

  function saveAgent(id: string, reportsTo: string | null): string {
    return db.agents.saveAgent({
      id,
      companyId,
      name: id,
      role: "Engineer",
      title: id,
      status: "active",
      reportsTo,
      connectorId: "openai-codex",
      workspaceId: null,
      model: null,
      capabilities: "Maintains hierarchy.",
      budgetMonthlyUsd: 100,
    });
  }
});
