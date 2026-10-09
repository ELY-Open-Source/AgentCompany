import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { AuthBrokerService } from "../../src/main/services/auth-broker-service";
import { loadCredential, type ProviderRow } from "../../src/main/services/provider-internal";

const vault = { encryptSecret: (secret: string) => Buffer.from(secret, "utf8"), decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8") };

describe("a saved cloud endpoint", () => {
  test("refills its form without the key, and a blank key keeps the saved one", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-endpoint-${randomUUID()}.db`));
    const db = connection.db;
    const providers = new ProviderService(db, providerAdapters, vault);
    let orgId = "";
    connection.transaction(() => {
      orgId = new OrganizationService(db).createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
    });
    const azure = (db.prepare("select id from providers where org_id = ? and provider_key = 'azure-openai'").get(orgId) as { id: string }).id;
    const storedSecret = () => JSON.parse(loadCredential(new AuthBrokerService(db, vault), orgId, db.prepare("select * from providers where id = ?").get(azure) as unknown as ProviderRow).secret) as Record<string, unknown>;

    expect(providers.endpoint(orgId, azure)).toBeNull();
    const keep = (deployment: string) => JSON.stringify({ baseUrl: "https://acme.openai.azure.com", region: "", projectId: "", deployment, secret: "", keepSavedSecret: true });
    expect(() => providers.saveCredential({ orgId, providerId: azure, secret: keep("d1"), model: "d1" })).toThrow("There is no saved key to keep; enter the key.");

    providers.saveCredential({ orgId, providerId: azure, secret: JSON.stringify({ baseUrl: "https://acme.openai.azure.com", region: "", projectId: "", deployment: "d1", secret: "az-key" }), model: "d1" });
    expect(providers.endpoint(orgId, azure)).toEqual({ baseUrl: "https://acme.openai.azure.com", region: "", projectId: "", deployment: "d1" });

    providers.saveCredential({ orgId, providerId: azure, secret: keep("d2"), model: "d2" });
    expect(providers.endpoint(orgId, azure)?.deployment).toBe("d2");
    expect(storedSecret()).toEqual({ baseUrl: "https://acme.openai.azure.com", region: "", projectId: "", deployment: "d2", secret: "az-key" });
  });
});
