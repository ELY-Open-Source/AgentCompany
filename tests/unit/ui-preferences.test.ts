import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";

describe("ui preferences", () => {
  test("every saved theme reads back as saved, the clock theme included; an unknown one fails loudly", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-ui-prefs-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    connection.transaction(() => organization.createOrganization({ organizationName: "Acme", employeeName: "Yang", mission: "m", goal: "g" }));
    for (const theme of ["system", "light", "dark", "clock"] as const) {
      organization.updateUiPreferences({ theme });
      expect(snapshot.load().uiPreferences.theme).toBe(theme);
    }
    connection.db.prepare("update app_state set theme = 'sepia' where id = 1").run();
    expect(() => snapshot.load()).toThrow('Stored theme "sepia" is not a known theme.');
    connection.close();
  });
});
