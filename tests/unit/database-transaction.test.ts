import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
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

describe("AppDatabase transactions", () => {
  let tempDir: string;
  let db: AppDatabase;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agentcompany-db-tx-"));
    db = new AppDatabase(tempDir);
    db.init();
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("rolls back nested transactions to their savepoint", () => {
    const outerCompanyId = db.withTransaction(() => {
      const companyId = db.core.company.saveCompany({
        name: "Nested Transaction Co",
        description: "Outer transaction should survive inner rollback.",
        status: "active",
      });

      expect(() => {
        db.withTransaction(() => {
          db.core.company.saveCompany({
            name: "Nested Transaction Rolled Back",
            description: "Inner transaction should roll back.",
            status: "active",
          });
          throw new Error("inner write failed");
        });
      }).toThrow("inner write failed");

      return companyId;
    });

    const companies = db.queryAll<{ id: string; name: string }>("select id, name from companies order by created_at asc");
    expect(companies.map((company) => company.id)).toContain(outerCompanyId);
    expect(companies.some((company) => company.name === "Nested Transaction Rolled Back")).toBe(false);
  });
});
