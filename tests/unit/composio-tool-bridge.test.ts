import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { loadComposioTools } from "../../src/main/services/composio/composio-tool-bridge";
import { IntegrationKeyStore } from "../../src/main/services/integration-key-store";

const plainVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

function ceoHarness() {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-composio-${randomUUID()}.db`));
  const organization = new OrganizationService(connection.db);
  let orgId = "";
  let ceoId = "";
  connection.transaction(() => {
    orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
    const providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
    ceoId = organization.createAgent({
      orgId, name: "CEO", role: "CEO", department: "Executive",
      modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null, roleLevel: "c_suite",
    });
  });
  return { connection, orgId, ceoId };
}

describe("composio tool loading", () => {
  test("an agent without connector access loads no tools and needs no key", async () => {
    const { connection, orgId, ceoId } = ceoHarness();
    expect(loadComposioTools(connection.db, new IntegrationKeyStore(connection.db, plainVault), orgId, ceoId)).toEqual([]);
    connection.close();
  });

  test("an agent with connector access fails loudly when the Composio key is missing", async () => {
    const { connection, orgId, ceoId } = ceoHarness();
    const now = new Date().toISOString();
    connection.db.prepare(`
      insert into connector_accounts(id, org_id, toolkit_slug, toolkit_name, auth_config_id, status, created_at, updated_at)
      values ('ca_1', ?, 'gmail', 'Gmail', 'ac_1', 'ACTIVE', ?, ?)
    `).run(orgId, now, now);
    expect(() => loadComposioTools(connection.db, new IntegrationKeyStore(connection.db, plainVault), orgId, ceoId)).toThrow("no Composio API key is saved");
    connection.close();
  });
});
