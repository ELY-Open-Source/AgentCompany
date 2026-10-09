import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { setProviderModel } from "../../src/main/services/provider-default-model";

const vault = { encryptSecret: (secret: string) => Buffer.from(secret, "utf8"), decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8") };

describe("changing a connected provider's default model", () => {
  test("changes only the model: the credential, its sign-in and its health stay as they were", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-default-model-${randomUUID()}.db`));
    const db = connection.db;
    const providers = new ProviderService(db, providerAdapters, vault);
    let orgId = "";
    connection.transaction(() => {
      orgId = new OrganizationService(db).createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
    });
    const idOf = (key: string) => (db.prepare("select id from providers where org_id = ? and provider_key = ?").get(orgId, key) as { id: string }).id;
    const openai = idOf("openai");
    providers.saveCredential({ orgId, providerId: openai, secret: "sk-test", model: "gpt-5.4" });
    db.prepare("update providers set health_state = 'healthy' where id = ?").run(openai);
    const before = db.prepare("select credential_id, auth_state, health_state from providers where id = ?").get(openai);

    setProviderModel(db, { orgId, providerId: openai, model: "  gpt-6  " });
    expect(db.prepare("select model from providers where id = ?").get(openai)).toEqual({ model: "gpt-6" });
    expect(db.prepare("select credential_id, auth_state, health_state from providers where id = ?").get(openai)).toEqual(before);
    expect(db.prepare("select action, payload_json from audit_events where entity_id = ? and action = 'default_model_changed'").get(openai))
      .toEqual({ action: "default_model_changed", payload_json: JSON.stringify({ from: "gpt-5.4", to: "gpt-6" }) });

    expect(() => setProviderModel(db, { orgId, providerId: openai, model: " " })).toThrow("Name the default model.");
    expect(() => setProviderModel(db, { orgId, providerId: idOf("anthropic"), model: "claude" })).toThrow("Connect this provider first; its default model is set when it connects.");
    db.prepare("update providers set credential_id = (select credential_id from providers where id = ?), auth_state = 'configured' where id = ?").run(openai, idOf("azure-openai"));
    expect(() => setProviderModel(db, { orgId, providerId: idOf("azure-openai"), model: "gpt-6" }))
      .toThrow("Azure OpenAI calls the deployment saved with its credential; change the deployment under Manage.");
  });
});
