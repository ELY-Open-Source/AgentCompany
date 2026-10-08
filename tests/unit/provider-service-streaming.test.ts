import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { providerAdapters, type ProviderAdapterRegistry } from "../../src/main/services/provider-adapters";
import { ProviderService } from "../../src/main/services/provider-service";
import type { ProviderStreamEvent } from "../../src/main/services/provider-streaming";
import { PROVIDER_EXECUTION_MODE, PROVIDER_REQUEST_STATE } from "../../src/shared/domain";
import type { ProviderStreamRendererEvent } from "../../src/shared/provider-request-domain";

function createConnection(): DatabaseConnection {
  return new DatabaseConnection(join(tmpdir(), `agentcompany-new-provider-stream-${randomUUID()}.db`));
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

describe("provider service streaming", () => {
  test("persists provider stream progress and completion", async () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const emitted: ProviderStreamRendererEvent[] = [];
    const adapters: ProviderAdapterRegistry = {
      ...providerAdapters,
      openai: {
        ...providerAdapters.openai,
        parseAuthProfile: (secret) => ({ type: "api_key", apiKey: secret.trim() }),
        streamResponse: async () => ({
          events: streamEvents([
            event("message_start", null, "created", "resp_live_1"),
            event("text_delta", "Hel", "delta-1", "resp_live_1"),
            event("text_delta", "lo", "delta-2", "resp_live_1"),
            event("message_stop", null, "completed", "resp_live_1"),
          ]),
          rateLimitState: {
            requestLimit: 120,
            remainingRequests: 118,
            resetAt: "2026-05-23T12:00:00.000Z",
            retryAfterMs: null,
            rawStateJson: JSON.stringify({ "x-ratelimit-remaining-requests": "118" }),
          },
        }),
      },
    };
    const providers = new ProviderService(connection.db, adapters, testVault);
    let orgId = "";
    let openAiProviderId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      openAiProviderId = providerId(connection, orgId, "openai");
      providers.saveCredential({ orgId, providerId: openAiProviderId, secret: "sk-live-provider", model: "gpt-5.4" });
    });
    const requestId = await providers.streamResponse({
      orgId,
      providerId: openAiProviderId,
      prompt: "Draft board memo",
      instructions: null,
      executionMode: PROVIDER_EXECUTION_MODE.FOREGROUND,
    }, (streamEvent) => emitted.push(streamEvent));

    const request = connection.db.prepare(`
      select state, response_text, output_char_count, external_response_id, stream_event_count, raw_response_json
      from provider_requests
      where id = ?
    `).get(requestId) as {
      state: string;
      response_text: string;
      output_char_count: number;
      external_response_id: string;
      stream_event_count: number;
      raw_response_json: string;
    };
    const usage = connection.db.prepare(`
      select request_count, input_char_count, output_char_count
      from provider_usage_windows
      where org_id = ? and provider_id = ?
    `).get(orgId, openAiProviderId);

    expect(request).toMatchObject({
      state: PROVIDER_REQUEST_STATE.SUCCEEDED,
      response_text: "Hello",
      output_char_count: 5,
      external_response_id: "resp_live_1",
      stream_event_count: 4,
    });
    expect(JSON.parse(request.raw_response_json)).toEqual(["created", "delta-1", "delta-2", "completed"]);
    expect(usage).toEqual({ request_count: 1, input_char_count: 16, output_char_count: 5 });
    expect(emitted.map((item) => [item.streamEventType, item.textDelta, item.responseText])).toEqual([
      ["message_start", null, ""],
      ["text_delta", "Hel", "Hel"],
      ["text_delta", "lo", "Hello"],
      ["message_stop", null, "Hello"],
    ]);
    expect(connection.db.prepare("select remaining_requests from provider_rate_limit_observations").get()).toEqual({ remaining_requests: 118 });
    connection.close();
  });

  test("a stream that ends without the provider's stop fails instead of saving the partial text", async () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const adapters: ProviderAdapterRegistry = {
      ...providerAdapters,
      openai: {
        ...providerAdapters.openai,
        parseAuthProfile: (secret) => ({ type: "api_key", apiKey: secret.trim() }),
        streamResponse: async () => ({
          events: streamEvents([event("message_start", null, "created", "resp_cut"), event("text_delta", "Hal", "delta-1", "resp_cut")]),
          rateLimitState: null,
        }),
      },
    };
    const providers = new ProviderService(connection.db, adapters, testVault);
    let orgId = "";
    let openAiProviderId = "";
    connection.transaction(() => {
      orgId = createOrganization(organization);
      openAiProviderId = providerId(connection, orgId, "openai");
      providers.saveCredential({ orgId, providerId: openAiProviderId, secret: "sk-live-provider", model: "gpt-5.4" });
    });
    await expect(providers.streamResponse({ orgId, providerId: openAiProviderId, prompt: "Draft", instructions: null, executionMode: PROVIDER_EXECUTION_MODE.FOREGROUND }, () => {}))
      .rejects.toThrow("no stop reason");
    expect(connection.db.prepare("select state from provider_requests where org_id = ?").get(orgId)).toEqual({ state: PROVIDER_REQUEST_STATE.FAILED });
    connection.close();
  });

  test("cancels a provider request through the adapter response id", async () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    let cancelledResponseId = "";
    const adapters: ProviderAdapterRegistry = {
      ...providerAdapters,
      openai: {
        ...providerAdapters.openai,
        parseAuthProfile: (secret) => ({ type: "api_key", apiKey: secret.trim() }),
        cancelResponse: async ({ responseId }) => {
          cancelledResponseId = responseId;
          return { responseId, rawResponseJson: JSON.stringify({ id: responseId, status: "cancelled" }), rateLimitState: null };
        },
      },
    };
    const providers = new ProviderService(connection.db, adapters, testVault);
    let orgId = "";
    let openAiProviderId = "";
    const requestId = `preq_${randomUUID()}`;

    connection.transaction(() => {
      orgId = createOrganization(organization);
      openAiProviderId = providerId(connection, orgId, "openai");
      providers.saveCredential({ orgId, providerId: openAiProviderId, secret: "sk-live-provider", model: "gpt-5.4" });
      connection.db.prepare(`
        insert into provider_requests(
          id, org_id, provider_id, provider_key, workspace_id, model, prompt_sha256,
          response_text, raw_response_json, state, error_message, input_char_count,
          output_char_count, execution_mode, policy_decision, external_response_id,
          stream_event_count, cancelled_at, created_at, completed_at
        ) values (?, ?, ?, 'openai', null, 'gpt-5.4', ?, 'partial', '[]', ?, null, 6, 7, ?, 'allowed:standard:organization', ?, 2, null, ?, null)
      `).run(
        requestId,
        orgId,
        openAiProviderId,
        "prompt-sha",
        PROVIDER_REQUEST_STATE.STREAMING,
        PROVIDER_EXECUTION_MODE.FOREGROUND,
        "resp_live_cancel",
        new Date().toISOString(),
      );
    });
    await providers.cancelResponse({ orgId, requestId });

    const request = connection.db.prepare(`
      select state, external_response_id, raw_response_json, cancelled_at, completed_at
      from provider_requests
      where id = ?
    `).get(requestId) as {
      state: string;
      external_response_id: string;
      raw_response_json: string;
      cancelled_at: string;
      completed_at: string;
    };

    expect(cancelledResponseId).toBe("resp_live_cancel");
    expect(request.state).toBe(PROVIDER_REQUEST_STATE.CANCELLED);
    expect(request.external_response_id).toBe("resp_live_cancel");
    expect(JSON.parse(request.raw_response_json)).toEqual({ id: "resp_live_cancel", status: "cancelled" });
    expect(request.cancelled_at).toHaveLength(24);
    expect(request.completed_at).toBe(request.cancelled_at);
    connection.close();
  });
});

describe("cancelled streams", () => {
  test("a cancelled stream stays cancelled when later events and the final result arrive", async () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const emitted: string[] = [];
    let cancel = async () => {};
    async function* liveEvents(): AsyncIterable<ProviderStreamEvent> {
      yield event("text_delta", "Hel", "delta-1", "resp_live_2");
      await cancel();
      yield event("text_delta", "lo", "delta-2", "resp_live_2");
      yield event("message_stop", null, "completed", "resp_live_2");
    }
    const adapters: ProviderAdapterRegistry = {
      ...providerAdapters,
      openai: {
        ...providerAdapters.openai,
        parseAuthProfile: (secret) => ({ type: "api_key", apiKey: secret.trim() }),
        streamResponse: async () => ({ events: liveEvents(), rateLimitState: null }),
        cancelResponse: async ({ responseId }) => ({ responseId, rawResponseJson: JSON.stringify({ id: responseId, status: "cancelled" }), rateLimitState: null }),
      },
    };
    const providers = new ProviderService(connection.db, adapters, testVault);
    let orgId = "";
    let openAiProviderId = "";
    connection.transaction(() => {
      orgId = createOrganization(organization);
      openAiProviderId = providerId(connection, orgId, "openai");
      providers.saveCredential({ orgId, providerId: openAiProviderId, secret: "sk-live-provider", model: "gpt-5.4" });
    });
    cancel = async () => {
      const live = connection.db.prepare("select id from provider_requests where state = 'streaming'").get() as { id: string };
      await providers.cancelResponse({ orgId, requestId: live.id });
    };
    const requestId = await providers.streamResponse({
      orgId, providerId: openAiProviderId, prompt: "Draft", instructions: null, executionMode: PROVIDER_EXECUTION_MODE.FOREGROUND,
    }, (streamEvent) => emitted.push(streamEvent.responseText));

    expect(connection.db.prepare("select state, response_text from provider_requests where id = ?").get(requestId))
      .toEqual({ state: PROVIDER_REQUEST_STATE.CANCELLED, response_text: "Hel" });
    expect(emitted).toEqual(["Hel"]);
    expect(connection.db.prepare("select count(*) as n from provider_usage_windows where org_id = ? and output_char_count > 0").get(orgId)).toEqual({ n: 0 });
    connection.close();
  });
});

async function* streamEvents(events: ProviderStreamEvent[]): AsyncIterable<ProviderStreamEvent> {
  for (const item of events) yield item;
}

function event(
  type: ProviderStreamEvent["type"],
  textDelta: string | null,
  rawEventJson: string,
  providerResponseId: string | null,
): ProviderStreamEvent {
  return { type, textDelta, rawEventJson, providerResponseId };
}
