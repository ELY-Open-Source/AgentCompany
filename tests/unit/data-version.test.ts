import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { bumpDataVersion, currentDataVersion } from "../../src/main/services/data-version";
import { supersedes } from "../../src/renderer/src/app/snapshot-order";

describe("data version", () => {
  test("a snapshot read after a change carries that change's version, so its own change event needs no reload", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-data-version-${randomUUID()}.db`));
    const snapshot = new SnapshotService(connection.db);
    const before = snapshot.load().dataVersion;
    const announced = bumpDataVersion();
    const after = snapshot.load();
    expect(after.dataVersion).toBe(announced);
    expect(announced).toBeGreaterThan(before);
    // A later change is newer than what is shown, so it is reloaded.
    expect(bumpDataVersion()).toBeGreaterThan(after.dataVersion);
    expect(currentDataVersion()).toBe(after.dataVersion + 1);
    // Records the window never reads are not shipped with every reload.
    expect(Object.keys(after)).not.toEqual(expect.arrayContaining(["operationalEvents", "featureFlags", "approvalAssignments", "roleGrants"]));
    connection.close();
  });
});

describe("snapshot order", () => {
  test("a late answer read at an older version never replaces newer data on screen", () => {
    expect(supersedes(2, 1)).toBe(false);
    expect(supersedes(2, 2)).toBe(true);
    expect(supersedes(2, 3)).toBe(true);
    expect(supersedes(-1, 0)).toBe(true);
  });
});
