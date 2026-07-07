import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { authConfigPurgeSchema } from "../../src/main/database/migrations/047-auth-config-purge";
import { OrganizationService } from "../../src/main/services/organization-service";

describe("auth config purge migration", () => {
  test("removes cached auth_config rows but keeps the entity id", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-authconfig-purge-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "OrbitOps", employeeName: "Yang", mission: "m", goal: "g" });
    });
    const now = new Date().toISOString();
    const insert = connection.db.prepare(
      "insert into composio_settings(org_id, key, value, updated_at) values (?, ?, ?, ?)",
    );
    insert.run(orgId, "entity_id", orgId, now);
    insert.run(orgId, "auth_config:github", "ac_123", now);
    insert.run(orgId, "auth_config:stripe", "ac_456", now);

    connection.db.exec(authConfigPurgeSchema);

    const keys = (connection.db.prepare("select key from composio_settings where org_id = ? order by key asc").all(orgId) as Array<{ key: string }>)
      .map((row) => row.key);
    expect(keys).toEqual(["entity_id"]);
  });
});
