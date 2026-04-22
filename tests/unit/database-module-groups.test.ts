import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppDatabase } from "../../src/main/database";

const FLAT_MODULE_KEYS = [
  "threads",
  "company",
  "agents",
  "tasks",
  "messages",
  "runs",
  "snap",
  "settings",
  "connectorsCrud",
  "workspacesMod",
  "approvalsMod",
  "social",
  "activityMod",
  "skills",
  "budget",
  "entityCrud",
  "documentsMod",
  "automationMod",
  "knowledgeMod",
  "wakeup",
  "backupMod",
  "sessionEntries",
  "inboxProjections",
  "documentLifecycleEvents",
  "credentialsTable",
  "modelCapabilities",
];

describe("AppDatabase module groups", () => {
  it("exposes domain modules through grouped namespaces", () => {
    const dir = mkdtempSync(join(tmpdir(), "agentcompany-db-groups-"));
    const db = new AppDatabase(dir);
    try {
      expect(Object.keys(db.core).sort()).toEqual([
        "activity",
        "agents",
        "approvals",
        "backup",
        "budget",
        "company",
        "connectors",
        "credentials",
        "documents",
        "entity",
        "knowledge",
        "messages",
        "modelCapabilities",
        "runs",
        "settings",
        "skills",
        "social",
        "tasks",
        "threads",
        "workspaces",
      ]);
      expect(Object.keys(db.automation).sort()).toEqual(["rules", "wakeup"]);
      expect(Object.keys(db.projection).sort()).toEqual([
        "documentLifecycleEvents",
        "inbox",
        "sessionEntries",
        "snapshot",
      ]);
      for (const key of FLAT_MODULE_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(db, key)).toBe(false);
      }
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
