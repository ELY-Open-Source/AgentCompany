import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchAnthropicModels, fetchOpenAiModels, mapAnthropicModels, mapOpenAiModels } from "../../src/main/services/provider-models-fetch";
import { DatabaseConnection } from "../../src/main/database/connection";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

describe("provider model-list mapping", () => {
  test("maps the OpenAI /models shape, deduping by id", () => {
    const models = mapOpenAiModels({ data: [{ id: "gpt-x" }, { id: "gpt-y" }, { id: "gpt-x" }, { id: "" }, { other: 1 }] });
    expect(models).toEqual([{ id: "gpt-x", name: "gpt-x" }, { id: "gpt-y", name: "gpt-y" }]);
  });

  test("maps the Anthropic /models shape, preferring display_name", () => {
    const models = mapAnthropicModels({ data: [{ id: "claude-x", display_name: "Claude X" }, { id: "claude-y" }] });
    expect(models).toEqual([{ id: "claude-x", name: "Claude X" }, { id: "claude-y", name: "claude-y" }]);
  });

  test("throws on a malformed response instead of returning a static list", () => {
    expect(() => mapOpenAiModels({})).toThrow(/expected shape/);
    expect(() => mapOpenAiModels({ data: [] })).toThrow(/no models/);
    expect(() => mapAnthropicModels({ data: [{ id: "" }] })).toThrow(/no models/);
  });
});

describe("ProviderService.listModels routing", () => {
  test("routes a typed credential to the matching adapter and returns its live models", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-models-${randomUUID()}.db`));
    let parsedSecret = "";
    const fakeAdapter = {
      ...providerAdapters.openai,
      authType: "api_key" as const,
      parseAuthProfile: (secret: string) => { parsedSecret = secret; return { type: "api_key" as const, apiKey: secret }; },
      listModels: async () => [{ id: "live-1", name: "live-1" }, { id: "live-2", name: "live-2" }],
    };
    const registry = { ...providerAdapters, openai: fakeAdapter };
    const service = new ProviderService(connection.db, registry, testVault);

    const models = await service.listModels({ providerKey: "openai", secret: "sk-live-key" });
    expect(parsedSecret).toBe("sk-live-key");
    expect(models).toEqual([{ id: "live-1", name: "live-1" }, { id: "live-2", name: "live-2" }]);
    connection.close();
  });

  test("requires a credential reference when no secret is provided", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-models-${randomUUID()}.db`));
    const service = new ProviderService(connection.db, providerAdapters, testVault);
    await expect(service.listModels({ providerKey: "openai" })).rejects.toThrow(/credential is required/);
    connection.close();
  });
});

describe("live model lists follow every page", () => {
  afterEach(() => vi.unstubAllGlobals());

  function pages(byCursor: Record<string, Record<string, unknown>>, seen: string[]) {
    vi.stubGlobal("fetch", async (url: string) => {
      seen.push(url);
      const cursor = new URL(url).searchParams.get("after_id") ?? new URL(url).searchParams.get("after") ?? "";
      return new Response(JSON.stringify(byCursor[cursor]), { status: 200, headers: { "content-type": "application/json" } });
    });
  }

  test("Anthropic pages through after_id at the largest page size until has_more is false", async () => {
    const seen: string[] = [];
    pages({
      "": { data: [{ id: "claude-a", display_name: "A" }], has_more: true, last_id: "claude-a" },
      "claude-a": { data: [{ id: "claude-b", display_name: "B" }], has_more: false, last_id: "claude-b" },
    }, seen);
    expect((await fetchAnthropicModels("https://api.anthropic.com/v1/models", {})).map((model) => model.id)).toEqual(["claude-a", "claude-b"]);
    expect(seen).toEqual(["https://api.anthropic.com/v1/models?limit=1000", "https://api.anthropic.com/v1/models?limit=1000&after_id=claude-a"]);
  });

  test("an OpenAI-style list that says has_more is followed through after; one without it is whole", async () => {
    const seen: string[] = [];
    pages({
      "": { data: [{ id: "m1" }], has_more: true, last_id: "m1" },
      m1: { data: [{ id: "m2" }], has_more: false },
    }, seen);
    expect((await fetchOpenAiModels("https://api.example.test/v1/models", {})).map((model) => model.id)).toEqual(["m1", "m2"]);
    expect(seen).toEqual(["https://api.example.test/v1/models", "https://api.example.test/v1/models?after=m1"]);
  });

  test("a page that says has_more without a cursor fails instead of returning part of the list", async () => {
    pages({ "": { data: [{ id: "claude-a" }], has_more: true, last_id: null } }, []);
    await expect(fetchAnthropicModels("https://api.anthropic.com/v1/models", {})).rejects.toThrow("more models but no cursor");
  });
});
