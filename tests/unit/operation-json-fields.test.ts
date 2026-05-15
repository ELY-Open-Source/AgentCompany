import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

import { AppDatabase } from "../../src/main/database";

describe("operation JSON fields", () => {
  let tempDir: string;
  let db: AppDatabase;
  let companyId: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-json-fields-"));
    db = new AppDatabase(tempDir);
    db.init();
    companyId = db.core.company.saveCompany({
      name: "JSON Field Co",
      description: "JSON field validation",
      status: "active",
    });
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("canonicalizes document and knowledge tag JSON at the DAO boundary", () => {
    const documentId = db.core.documents.saveDocument({
      companyId,
      type: "technical_spec",
      title: "Canonical tags",
      tagsJson: "[ \"security\", \"runtime\" ]",
    });
    const document = db.core.documents.getDocumentForUpdate(documentId, companyId);
    expect(document?.tagsJson).toBe("[\"security\",\"runtime\"]");

    const knowledgeId = db.core.knowledge.saveKnowledgeEntry({
      companyId,
      category: "technical",
      topic: "Canonical knowledge tags",
      content: "Persisted JSON is canonical.",
      tagsJson: "[ \"audit\" ]",
    });
    const knowledge = db.core.knowledge.listKnowledgeEntries(companyId).find((entry) => entry.id === knowledgeId);
    expect(knowledge?.tagsJson).toBe("[\"audit\"]");
  });

  it("rejects malformed meeting JSON before writing", () => {
    expect(() => db.core.knowledge.saveMeeting({
      companyId,
      type: "department_sync",
      title: "Broken JSON",
      scheduledAt: "2026-05-15T10:00:00.000Z",
      participantAgentIds: "[1]",
    })).toThrow();

    expect(db.core.knowledge.listMeetings(companyId)).toHaveLength(0);
  });
});
