import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { ERASE_RETIRED_CREDENTIALS_SQL } from "../../src/main/database/migrations/079-erase-retired-credentials";
import { AuthBrokerService } from "../../src/main/services/auth-broker-service";
import { loadConfiguredProvider } from "../../src/main/services/provider-internal";
import { resolveTurnCredential } from "../../src/main/services/provider-tool-turns/credential-resolver";

const vault = { encryptSecret: (secret: string) => Buffer.from(secret, "utf8"), decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8") };

afterEach(() => vi.unstubAllGlobals());

function company(providerKey: string, secret: string, model: string) {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-disconnect-${randomUUID()}.db`));
  const providers = new ProviderService(connection.db, providerAdapters, vault);
  let orgId = "";
  let providerId = "";
  connection.transaction(() => {
    orgId = new OrganizationService(connection.db).createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
    providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = ?").get(orgId, providerKey) as { id: string }).id;
    providers.saveCredential({ orgId, providerId, secret, model });
  });
  const ciphertexts = () => (connection.db.prepare("select length(ciphertext) as bytes from credentials order by created_at, rowid").all() as Array<{ bytes: number }>).map((row) => row.bytes);
  const lastRevocation = () => JSON.parse((connection.db.prepare("select payload_json from audit_events where action = 'credential_revoked' order by rowid desc").get() as { payload_json: string }).payload_json) as Record<string, unknown>;
  return { connection, providers, orgId, providerId, ciphertexts, lastRevocation };
}

describe("disconnecting a provider", () => {
  test("an API key is erased from this computer on disconnect, and a replaced key is erased too", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("no network call expected"); });
    const h = company("openai", "sk-first", "gpt-5.4");
    h.connection.transaction(() => h.providers.saveCredential({ orgId: h.orgId, providerId: h.providerId, secret: "sk-second", model: "gpt-5.4" }));
    expect(h.ciphertexts()).toEqual([0, 9]);
    h.connection.transaction(() => h.providers.revokeCredential({ orgId: h.orgId, providerId: h.providerId }));
    expect(h.ciphertexts()).toEqual([0, 0]);
    expect(h.lastRevocation()).toEqual({ providerKey: "openai" });
    h.connection.close();
  });

  test("a renewal that lands after the disconnect is discarded, not written back", async () => {
    let answer: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => { answer = resolve; }));
    const h = company("claude-pro", JSON.stringify({ access: "a", refresh: "r", expires: 0 }), "claude-sonnet-4-5");
    const renewal = resolveTurnCredential({ authBroker: new AuthBrokerService(h.connection.db, vault), orgId: h.orgId, provider: loadConfiguredProvider(h.connection.db, h.orgId, h.providerId) });
    h.connection.transaction(() => h.providers.revokeCredential({ orgId: h.orgId, providerId: h.providerId }));
    answer(new Response(JSON.stringify({ access_token: "new", refresh_token: "new-r", expires_in: 3600 }), { status: 200 }));
    await expect(renewal).rejects.toThrow("disconnected or replaced while it was being renewed");
    expect(h.ciphertexts()).toEqual([0]);
    h.connection.close();
  });

  test("credentials retired before this release are erased by the migration's statement", () => {
    const h = company("openai", "sk-old", "gpt-5.4");
    h.connection.db.prepare("update providers set credential_id = null where id = ?").run(h.providerId);
    h.connection.db.prepare("update provider_auth_profiles set active = 0").run();
    h.connection.db.exec(ERASE_RETIRED_CREDENTIALS_SQL);
    expect(h.ciphertexts()).toEqual([0]);
    h.connection.close();
  });
});
