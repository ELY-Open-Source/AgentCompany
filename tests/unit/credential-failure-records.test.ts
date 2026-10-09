import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { ProviderBackgroundService } from "../../src/main/services/provider-background-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { PROVIDER_DATA_POLICY, PROVIDER_EXECUTION_MODE } from "../../src/shared/domain";
import { markModelChecked } from "../helpers/model-check";

afterEach(() => vi.unstubAllGlobals());

/** A vault that stored secrets fine but can no longer open them, as after a lost OS key. */
function breakableVault() {
  const state = { broken: false };
  return {
    state,
    vault: {
      encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
      decryptSecret: (ciphertext: Buffer) => {
        if (state.broken) throw new Error("The stored secret could not be decrypted.");
        return ciphertext.toString("utf8");
      },
    },
  };
}

function company(providerKey: string, secret: string, model: string) {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-cred-rec-${randomUUID()}.db`));
  const { state, vault } = breakableVault();
  const providers = new ProviderService(connection.db, providerAdapters, vault);
  const background = new ProviderBackgroundService(connection.db, providerAdapters, vault);
  let orgId = "";
  let providerId = "";
  connection.transaction(() => {
    orgId = new OrganizationService(connection.db).createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
    providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = ?").get(orgId, providerKey) as { id: string }).id;
    providers.saveCredential({ orgId, providerId, secret, model });
    providers.updatePolicy({ orgId, providerId, dataPolicy: PROVIDER_DATA_POLICY.STANDARD, backgroundEnabled: true, monthlyRequestLimit: 100, workspaceScope: "organization", contextWindowTokens: 128_000 });
  });
  const failed = () => connection.db.prepare("select state, error_message from provider_requests order by rowid").all();
  return { connection, providers, background, orgId, providerId, state, failed };
}

describe("a credential that cannot be read or renewed leaves a failed request in the log", () => {
  test("one-shot, streamed and background requests record the unreadable credential", async () => {
    const h = company("openai", "sk-test", "gpt-5.4");
    h.state.broken = true;
    const request = { orgId: h.orgId, providerId: h.providerId, prompt: "p", instructions: null };
    await expect(h.providers.createResponse({ ...request, executionMode: PROVIDER_EXECUTION_MODE.FOREGROUND })).rejects.toThrow("could not be decrypted");
    await expect(h.providers.streamResponse({ ...request, executionMode: PROVIDER_EXECUTION_MODE.FOREGROUND }, () => {})).rejects.toThrow("could not be decrypted");
    await expect(h.background.create({ ...request, executionMode: PROVIDER_EXECUTION_MODE.BACKGROUND })).rejects.toThrow("could not be decrypted");
    expect(h.failed()).toEqual(Array.from({ length: 3 }, () => ({ state: "failed", error_message: "The stored secret could not be decrypted." })));
    h.connection.close();
  });

  test("an agent turn whose sign-in cannot be renewed records the refresh failure", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400, headers: { "content-type": "application/json" } }));
    const h = company("claude-pro", JSON.stringify({ access: "a", refresh: "r", expires: 0 }), "claude-sonnet-4-5");
    markModelChecked(h.connection.db, h.providerId, "claude-sonnet-4-5");
    await expect(h.providers.runToolTurn({ purpose: "agent_turn", orgId: h.orgId, providerId: h.providerId, workspaceId: null, instructions: "i", messages: [{ role: "user", text: "u" }], tools: [] }))
      .rejects.toThrow("Claude token refresh failed: 400");
    expect(h.failed()).toEqual([{ state: "failed", error_message: expect.stringContaining("Claude token refresh failed: 400") }]);
    h.connection.close();
  });
});
