import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { providerAdapters, type ProviderAdapterRegistry } from "../../src/main/services/provider-adapters";
import { ProviderBackgroundService } from "../../src/main/services/provider-background-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { PROVIDER_DATA_POLICY, PROVIDER_EXECUTION_MODE, PROVIDER_REQUEST_STATE } from "../../src/shared/domain";

function createConnection(): DatabaseConnection {
  return new DatabaseConnection(join(tmpdir(), `agentcompany-new-provider-background-${randomUUID()}.db`));
}

function createOrganization(organization: OrganizationService): string {
  return organization.createOrganization({
    organizationName: "Acme Operations",
    employeeName: "Dana Lee",
    mission: "Coordinate agents with auditable approvals.",
    goal: "Ship a verified control plane.",
  });
}

function providerId(connection: DatabaseConnection, orgId: string, key: string): string {
  return (connection.db.prepare("select id from providers where org_id = ? and provider_key = ?")
    .get(orgId, key) as { id: string }).id;
}

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

describe("provider background service", () => {
  test("creates a background response and recovers the completed result", async () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const adapters = backgroundAdapters("completed", "Background analysis complete.");
    const providers = new ProviderService(connection.db, adapters, testVault);
    const background = new ProviderBackgroundService(connection.db, adapters, testVault);
    let orgId = "";
    let openAiProviderId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      openAiProviderId = providerId(connection, orgId, "openai");
      providers.saveCredential({ orgId, providerId: openAiProviderId, secret: "sk-live-provider", model: "gpt-5.4" });
      providers.updatePolicy({
        orgId,
        providerId: openAiProviderId,
        dataPolicy: PROVIDER_DATA_POLICY.STANDARD,
        backgroundEnabled: true,
        monthlyRequestLimit: 10,
        workspaceScope: "organization", contextWindowTokens: 128_000,
      });
    });

    const requestId = await background.create({
      orgId,
      providerId: openAiProviderId,
      prompt: "Run long research",
      instructions: "Use verified citations.",
      executionMode: PROVIDER_EXECUTION_MODE.BACKGROUND,
    });
    await background.recoverBackgroundResponses();

    const request = connection.db.prepare(`
      select state, response_text, external_response_id, raw_response_json, input_char_count, output_char_count
      from provider_requests
      where id = ?
    `).get(requestId) as {
      state: string;
      response_text: string;
      external_response_id: string;
      raw_response_json: string;
      input_char_count: number;
      output_char_count: number;
    };
    const usage = connection.db.prepare(`
      select request_count, input_char_count, output_char_count
      from provider_usage_windows
      where org_id = ? and provider_id = ?
    `).get(orgId, openAiProviderId);
    const signal = connection.db.prepare("select success from operational_events where source = 'provider_gateway'").get();

    expect(request).toMatchObject({
      state: PROVIDER_REQUEST_STATE.SUCCEEDED,
      response_text: "Background analysis complete.",
      external_response_id: "resp_bg_1",
      input_char_count: "Run long research".length + "Use verified citations.".length,
      output_char_count: 29,
    });
    expect(JSON.parse(request.raw_response_json)).toMatchObject({ id: "resp_bg_1", status: "completed" });
    expect(usage).toEqual({ request_count: 1, input_char_count: 40, output_char_count: 29 });
    expect(signal).toEqual({ success: 1 });
    connection.close();
  });

  test("recovers active background requests across service instances", async () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const adapters = backgroundAdapters("in_progress", null);
    const providers = new ProviderService(connection.db, adapters, testVault);
    let orgId = "";
    let openAiProviderId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      openAiProviderId = providerId(connection, orgId, "openai");
      providers.saveCredential({ orgId, providerId: openAiProviderId, secret: "sk-live-provider", model: "gpt-5.4" });
      providers.updatePolicy({
        orgId,
        providerId: openAiProviderId,
        dataPolicy: PROVIDER_DATA_POLICY.STANDARD,
        backgroundEnabled: true,
        monthlyRequestLimit: 10,
        workspaceScope: "organization", contextWindowTokens: 128_000,
      });
    });

    const requestId = await new ProviderBackgroundService(connection.db, adapters, testVault).create({
      orgId,
      providerId: openAiProviderId,
      prompt: "Run long research",
      instructions: null,
      executionMode: PROVIDER_EXECUTION_MODE.BACKGROUND,
    });
    await new ProviderBackgroundService(connection.db, adapters, testVault).recoverBackgroundResponses();

    expect(connection.db.prepare("select state from provider_requests where id = ?").get(requestId))
      .toEqual({ state: PROVIDER_REQUEST_STATE.STREAMING });
    connection.close();
  });

  test("persists failed background response payloads", async () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const adapters = backgroundAdapters("failed", null);
    const providers = new ProviderService(connection.db, adapters, testVault);
    const background = new ProviderBackgroundService(connection.db, adapters, testVault);
    let orgId = "";
    let openAiProviderId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      openAiProviderId = providerId(connection, orgId, "openai");
      providers.saveCredential({ orgId, providerId: openAiProviderId, secret: "sk-live-provider", model: "gpt-5.4" });
      providers.updatePolicy({
        orgId,
        providerId: openAiProviderId,
        dataPolicy: PROVIDER_DATA_POLICY.STANDARD,
        backgroundEnabled: true,
        monthlyRequestLimit: 10,
        workspaceScope: "organization", contextWindowTokens: 128_000,
      });
    });

    const requestId = await background.create({
      orgId,
      providerId: openAiProviderId,
      prompt: "Run long research",
      instructions: null,
      executionMode: PROVIDER_EXECUTION_MODE.BACKGROUND,
    });
    await background.poll({ orgId, requestId });

    const request = connection.db.prepare(`
      select state, error_message, raw_response_json
      from provider_requests
      where id = ?
    `).get(requestId) as { state: string; error_message: string; raw_response_json: string };

    expect(request.state).toBe(PROVIDER_REQUEST_STATE.FAILED);
    expect(request.error_message).toBe("provider worker failed");
    expect(JSON.parse(request.raw_response_json)).toMatchObject({ id: "resp_bg_1", status: "failed" });
    connection.close();
  });
});

describe("background polling failures", () => {
  test("a failed status check keeps the request recoverable; only repeated failures give up", async () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    let pollFailures = 2;
    let status = "completed";
    const base = backgroundAdapters("completed", "Late result.");
    const adapters: ProviderAdapterRegistry = {
      ...base,
      openai: {
        ...base.openai,
        retrieveResponse: async (input) => {
          if (pollFailures > 0) {
            pollFailures -= 1;
            throw new Error("fetch failed: ECONNRESET");
          }
          const result = await base.openai.retrieveResponse(input);
          return { ...result, status };
        },
      },
    };
    const providers = new ProviderService(connection.db, adapters, testVault);
    const background = new ProviderBackgroundService(connection.db, adapters, testVault);
    let orgId = "";
    let openAiProviderId = "";
    connection.transaction(() => {
      orgId = createOrganization(organization);
      openAiProviderId = providerId(connection, orgId, "openai");
      providers.saveCredential({ orgId, providerId: openAiProviderId, secret: "sk-live-provider", model: "gpt-5.4" });
      providers.updatePolicy({
        orgId, providerId: openAiProviderId, dataPolicy: PROVIDER_DATA_POLICY.STANDARD, backgroundEnabled: true,
        monthlyRequestLimit: 10, workspaceScope: "organization", contextWindowTokens: 128_000,
      });
    });
    const requestId = await background.create({ orgId, providerId: openAiProviderId, prompt: "Research", instructions: null, executionMode: PROVIDER_EXECUTION_MODE.BACKGROUND });
    const row = () => connection.db.prepare("select state, poll_failures, last_poll_error, response_text from provider_requests where id = ?").get(requestId);

    expect(await background.recoverBackgroundResponses()).toBe(1);
    expect(row()).toMatchObject({ state: PROVIDER_REQUEST_STATE.PENDING, poll_failures: 1, last_poll_error: "fetch failed: ECONNRESET" });
    await background.recoverBackgroundResponses();
    await background.recoverBackgroundResponses();
    expect(row()).toMatchObject({ state: PROVIDER_REQUEST_STATE.SUCCEEDED, poll_failures: 0, response_text: "Late result." });

    pollFailures = 100;
    const doomed = await background.create({ orgId, providerId: openAiProviderId, prompt: "Research again", instructions: null, executionMode: PROVIDER_EXECUTION_MODE.BACKGROUND });
    for (let attempt = 0; attempt < 10; attempt += 1) await background.poll({ orgId, requestId: doomed });
    expect(connection.db.prepare("select state, error_message from provider_requests where id = ?").get(doomed))
      .toEqual({ state: PROVIDER_REQUEST_STATE.FAILED, error_message: "Gave up after 10 failed status checks: fetch failed: ECONNRESET" });

    // An answer that is not a valid result (unknown status) also counts, so it cannot stay pending forever.
    pollFailures = 0;
    status = "mystery";
    const odd = await background.create({ orgId, providerId: openAiProviderId, prompt: "Odd", instructions: null, executionMode: PROVIDER_EXECUTION_MODE.BACKGROUND });
    for (let attempt = 0; attempt < 10; attempt += 1) await background.poll({ orgId, requestId: odd });
    expect(connection.db.prepare("select state from provider_requests where id = ?").get(odd)).toEqual({ state: PROVIDER_REQUEST_STATE.FAILED });
    connection.close();
  });
});

function backgroundAdapters(status: string, text: string | null): ProviderAdapterRegistry {
  return {
    ...providerAdapters,
    openai: {
      ...providerAdapters.openai,
      parseAuthProfile: (secret) => ({ type: "api_key", apiKey: secret.trim() }),
      createBackgroundResponse: async () => ({
        responseId: "resp_bg_1",
        status: "queued",
        rawResponseJson: JSON.stringify({ id: "resp_bg_1", status: "queued" }),
        rateLimitState: null,
      }),
      retrieveResponse: async () => ({
        responseId: "resp_bg_1",
        status,
        text,
        rawResponseJson: JSON.stringify({
          id: "resp_bg_1",
          status,
          error: status === "failed" ? { message: "provider worker failed" } : null,
          output_text: text,
        }),
        rateLimitState: null,
      }),
    },
  };
}
