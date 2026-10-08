import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { AuthBrokerService } from "../../src/main/services/auth-broker-service";
import { IntegrationKeyStore } from "../../src/main/services/integration-key-store";
import { loadConfiguredProvider } from "../../src/main/services/provider-internal";
import { resolveTurnCredential } from "../../src/main/services/provider-tool-turns/credential-resolver";

const vault = { encryptSecret: (secret: string) => Buffer.from(secret, "utf8"), decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8") };

afterEach(() => vi.unstubAllGlobals());

/** A token endpoint that rotates refresh tokens: each one works once, as rotating providers do. */
function rotatingTokenEndpoint() {
  let generation = 0;
  const valid = new Set(["refresh-0"]);
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const used = (JSON.parse(String(init.body)) as { refresh_token: string }).refresh_token;
    calls.push(used);
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (!valid.delete(used)) return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400, headers: { "content-type": "application/json" } });
    generation += 1;
    valid.add(`refresh-${generation}`);
    return new Response(JSON.stringify({ access_token: `access-${generation}`, refresh_token: `refresh-${generation}`, expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } });
  });
  return calls;
}

function expiredClaudePro() {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-refresh-${randomUUID()}.db`));
  const providers = new ProviderService(connection.db, providerAdapters, vault);
  let orgId = "";
  let providerId = "";
  connection.transaction(() => {
    orgId = new OrganizationService(connection.db).createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
    providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'claude-pro'").get(orgId) as { id: string }).id;
    providers.saveCredential({ orgId, providerId, secret: JSON.stringify({ access: "access-0", refresh: "refresh-0", expires: 0 }), model: "claude-sonnet-4-5" });
  });
  const deps = { authBroker: new AuthBrokerService(connection.db, vault), integrationKeys: new IntegrationKeyStore(connection.db, vault), orgId };
  const resolve = () => resolveTurnCredential({ ...deps, provider: loadConfiguredProvider(connection.db, orgId, providerId) });
  return { connection, resolve };
}

describe("an expired sign-in is refreshed once, however many runs need it", () => {
  test("runs that need it at the same time share one refresh and the rotated token survives", async () => {
    const calls = rotatingTokenEndpoint();
    const h = expiredClaudePro();
    const credentials = await Promise.all([h.resolve(), h.resolve(), h.resolve()]);
    expect(credentials.map((credential) => credential.accessToken)).toEqual(["access-1", "access-1", "access-1"]);
    expect(calls).toEqual(["refresh-0"]);
    h.connection.close();
  });

  test("a run that comes after the refresh uses the stored new sign-in", async () => {
    const calls = rotatingTokenEndpoint();
    const h = expiredClaudePro();
    expect((await h.resolve()).accessToken).toBe("access-1");
    expect((await h.resolve()).accessToken).toBe("access-1");
    expect(calls).toEqual(["refresh-0"]);
    h.connection.close();
  });
});
