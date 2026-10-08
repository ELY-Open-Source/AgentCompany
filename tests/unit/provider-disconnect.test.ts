import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { PROVIDER_CATALOG } from "../../src/shared/provider-catalog";
import { ERASE_RETIRED_CREDENTIALS_SQL } from "../../src/main/database/migrations/079-erase-retired-credentials";
import { AuthBrokerService } from "../../src/main/services/auth-broker-service";
import { IntegrationKeyStore } from "../../src/main/services/integration-key-store";
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
  test("only Google Antigravity's sign-in can be revoked at the provider; the catalog says so", () => {
    expect(PROVIDER_CATALOG.filter((entry) => entry.revokesRemotely).map((entry) => entry.key)).toEqual(["google-antigravity"]);
  });

  test("an API key is erased from this computer on disconnect, and a replaced key is erased too", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("no network call expected"); });
    const h = company("openai", "sk-first", "gpt-5.4");
    h.connection.transaction(() => h.providers.saveCredential({ orgId: h.orgId, providerId: h.providerId, secret: "sk-second", model: "gpt-5.4" }));
    expect(h.ciphertexts()).toEqual([0, 9]);
    await h.providers.revokeCredential({ orgId: h.orgId, providerId: h.providerId });
    expect(h.ciphertexts()).toEqual([0, 0]);
    expect(h.lastRevocation()).toMatchObject({ providerKey: "openai", remote: "not_supported" });
    h.connection.close();
  });

  test("a Google sign-in is revoked at Google before it is erased here", async () => {
    const revoked: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      revoked.push(`${url} ${String(init.body)}`);
      return new Response("", { status: 200 });
    });
    const h = company("google-antigravity", JSON.stringify({ access: "ya29", refresh: "1//refresh", expires: 1_900_000_000_000, projectId: "p" }), "gemini-3-pro");
    await h.providers.revokeCredential({ orgId: h.orgId, providerId: h.providerId });
    expect(revoked).toEqual(["https://oauth2.googleapis.com/revoke token=1%2F%2Frefresh"]);
    expect(h.ciphertexts()).toEqual([0]);
    expect(h.lastRevocation()).toMatchObject({ remote: "revoked" });
    h.connection.close();
  });

  test("when Google does not confirm, the sign-in is still disconnected and erased here, and the failure is said plainly", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "invalid_token" }), { status: 400, headers: { "content-type": "application/json" } }));
    const h = company("google-antigravity", JSON.stringify({ access: "ya29", refresh: "1//refresh", expires: 1_900_000_000_000, projectId: "p" }), "gemini-3-pro");
    await expect(h.providers.revokeCredential({ orgId: h.orgId, providerId: h.providerId }))
      .rejects.toThrow("Disconnected on this computer, but Google Antigravity did not confirm revoking the sign-in");
    expect(h.connection.db.prepare("select enabled, credential_id from providers where id = ?").get(h.providerId)).toEqual({ enabled: 0, credential_id: null });
    expect(h.ciphertexts()).toEqual([0]);
    expect(h.lastRevocation()).toMatchObject({ remote: "failed", remoteError: expect.stringContaining("400") });
    h.connection.close();
  });

  test("a renewal that lands after the disconnect is discarded, not written back", async () => {
    let answer: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => { answer = resolve; }));
    const h = company("claude-pro", JSON.stringify({ access: "a", refresh: "r", expires: 0 }), "claude-sonnet-4-5");
    const renewal = resolveTurnCredential({ authBroker: new AuthBrokerService(h.connection.db, vault), integrationKeys: new IntegrationKeyStore(h.connection.db, vault), orgId: h.orgId, provider: loadConfiguredProvider(h.connection.db, h.orgId, h.providerId) });
    await h.providers.revokeCredential({ orgId: h.orgId, providerId: h.providerId });
    answer(new Response(JSON.stringify({ access_token: "new", refresh_token: "new-r", expires_in: 3600 }), { status: 200 }));
    await expect(renewal).rejects.toThrow("disconnected or replaced while it was being renewed");
    expect(h.ciphertexts()).toEqual([0]);
    h.connection.close();
  });

  test("a reconnect made while Google answers keeps the new connection and erases only the old sign-in", async () => {
    let answer: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => { answer = resolve; }));
    const signIn = (refresh: string) => JSON.stringify({ access: "ya29", refresh, expires: 1_900_000_000_000, projectId: "p" });
    const h = company("google-antigravity", signIn("1//old"), "gemini-3-pro");
    const disconnecting = h.providers.revokeCredential({ orgId: h.orgId, providerId: h.providerId });
    h.connection.transaction(() => h.providers.saveCredential({ orgId: h.orgId, providerId: h.providerId, secret: signIn("1//new"), model: "gemini-3-pro" }));
    answer(new Response("", { status: 200 }));
    await expect(disconnecting).rejects.toThrow("was reconnected while it was being disconnected");
    expect(h.connection.db.prepare("select enabled from providers where id = ?").get(h.providerId)).toEqual({ enabled: 1 });
    expect(h.ciphertexts()).toEqual([0, signIn("1//new").length]);
    h.connection.close();
  });

  test("a reconnect and a refused revocation at once are both reported", async () => {
    let answer: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => { answer = resolve; }));
    const signIn = (refresh: string) => JSON.stringify({ access: "ya29", refresh, expires: 1_900_000_000_000, projectId: "p" });
    const h = company("google-antigravity", signIn("1//old"), "gemini-3-pro");
    const disconnecting = h.providers.revokeCredential({ orgId: h.orgId, providerId: h.providerId });
    h.connection.transaction(() => h.providers.saveCredential({ orgId: h.orgId, providerId: h.providerId, secret: signIn("1//new"), model: "gemini-3-pro" }));
    answer(new Response(JSON.stringify({ error: "invalid_token" }), { status: 400, headers: { "content-type": "application/json" } }));
    const failure = (await disconnecting.catch((error: unknown) => error)) as Error;
    expect(failure.message).toContain("was reconnected while it was being disconnected");
    expect(failure.message).toContain("did not confirm revoking the sign-in (Google revocation failed: 400");
    expect(failure.message).toContain("revoke it in your account");
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
