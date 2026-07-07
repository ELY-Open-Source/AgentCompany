import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { resolveComposioApiKey } from "../../src/main/services/composio/composio-credentials";

interface Harness {
  connection: DatabaseConnection;
  orgId: string;
  credDir: string;
}

function harness(): Harness {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-cred-${randomUUID()}.db`));
  const organization = new OrganizationService(connection.db);
  let orgId = "";
  connection.transaction(() => {
    orgId = organization.createOrganization({ organizationName: "OrbitOps", employeeName: "Yang", mission: "m", goal: "g" });
  });
  const credDir = join(tmpdir(), `ac-cred-dir-${randomUUID()}`);
  mkdirSync(credDir, { recursive: true });
  return { connection, orgId, credDir };
}

function storedKey(h: Harness): string | null {
  const row = h.connection.db.prepare(
    "select value from composio_settings where org_id = ? and key = 'api_key'",
  ).get(h.orgId) as { value: string } | undefined;
  return row?.value ?? null;
}

function writeCred(h: Harness, key: string): void {
  writeFileSync(join(h.credDir, "cred.txt"), `Composio apikey: ${key}\nProject id: pr_x\n`, "utf8");
}

describe("composio credential resolution", () => {
  test("seeds the database from the credential file", () => {
    const h = harness();
    writeCred(h, "ak_first");
    expect(resolveComposioApiKey(h.connection.db, h.orgId, [h.credDir])).toBe("ak_first");
    expect(storedKey(h)).toBe("ak_first");
  });

  test("a rotated credential file replaces the stale stored key", () => {
    const h = harness();
    writeCred(h, "ak_old");
    resolveComposioApiKey(h.connection.db, h.orgId, [h.credDir]);
    writeCred(h, "ak_rotated");
    expect(resolveComposioApiKey(h.connection.db, h.orgId, [h.credDir])).toBe("ak_rotated");
    expect(storedKey(h)).toBe("ak_rotated");
  });

  test("finds the credential file in a later directory when the first has none", () => {
    const h = harness();
    writeCred(h, "ak_resources");
    const emptyDir = join(tmpdir(), `ac-cred-empty-${randomUUID()}`);
    mkdirSync(emptyDir, { recursive: true });
    expect(resolveComposioApiKey(h.connection.db, h.orgId, [emptyDir, h.credDir])).toBe("ak_resources");
    expect(storedKey(h)).toBe("ak_resources");
  });

  test("without a credential file the stored key stands", () => {
    const h = harness();
    const now = new Date().toISOString();
    h.connection.db.prepare(
      "insert into composio_settings(org_id, key, value, updated_at) values (?, 'api_key', 'ak_settings', ?)",
    ).run(h.orgId, now);
    expect(resolveComposioApiKey(h.connection.db, h.orgId, [h.credDir])).toBe("ak_settings");
  });

  test("no file and no stored key yields null", () => {
    const h = harness();
    expect(resolveComposioApiKey(h.connection.db, h.orgId, [h.credDir])).toBeNull();
  });
});
