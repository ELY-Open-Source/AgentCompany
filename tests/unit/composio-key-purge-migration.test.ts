import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { composioKeyPurgeSchema } from "../../src/main/database/migrations/046-composio-key-purge";
import { OrganizationService } from "../../src/main/services/organization-service";

describe("composio key purge migration", () => {
  test("removes stored api_key and toolkits rows but keeps connection state", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-purge-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "OrbitOps", employeeName: "Yang", mission: "m", goal: "g" });
    });
    const now = new Date().toISOString();
    const insert = connection.db.prepare(
      "insert into composio_settings(org_id, key, value, updated_at) values (?, ?, ?, ?)",
    );
    insert.run(orgId, "api_key", "ak_revoked", now);
    insert.run(orgId, "toolkits", '["github"]', now);
    insert.run(orgId, "entity_id", orgId, now);
    insert.run(orgId, "auth_config:github", "ac_123", now);

    connection.db.exec(composioKeyPurgeSchema);

    const keys = (connection.db.prepare("select key from composio_settings where org_id = ? order by key asc").all(orgId) as Array<{ key: string }>)
      .map((row) => row.key);
    expect(keys).toEqual(["auth_config:github", "entity_id"]);
  });
});
