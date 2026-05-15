import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getProviders } from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";
import {
  CONNECTORS,
  getConnectorKnownProvider,
  getConnectorProvider,
  isLocalModelResolverProvider,
  isPiKnownProvider,
} from "../../src/main/connectors";
import { FIREWORKS_FIREPASS_MODEL_ID, fetchLocalConnectorModels, resolveModel, resolveModels } from "../../src/main/model-resolver";

describe("connector provider guard", () => {
  it("classifies catalog providers before they enter pi-ai APIs", () => {
    const piProviders = new Set(getProviders());

    for (const connector of CONNECTORS) {
      const provider = getConnectorProvider(connector.id);
      expect(provider).toBe(connector.provider);

      if (isLocalModelResolverProvider(provider)) {
        expect(getConnectorKnownProvider(connector.id)).toBeNull();
      } else {
        expect(isPiKnownProvider(provider)).toBe(true);
        expect(piProviders.has(provider)).toBe(true);
        expect(getConnectorKnownProvider(connector.id)).toBe(provider);
      }
    }
  });

  it("uses the provider guard in model discovery", () => {
    const anthropicModels = resolveModels("anthropic");
    const firstAnthropicModel = anthropicModels[0];
    if (!firstAnthropicModel) throw new Error("Anthropic model catalog is empty.");

    expect(resolveModel("anthropic", firstAnthropicModel.id)?.id).toBe(firstAnthropicModel.id);
    expect(resolveModels("not-a-pi-provider")).toEqual([]);
    expect(resolveModel("not-a-pi-provider", "model-id")).toBeNull();
    expect(resolveModel("fireworks-firepass", "ignored")?.id).toBe(FIREWORKS_FIREPASS_MODEL_ID);
    expect(resolveModel("ollama", "llama3.2", { baseUrl: "http://127.0.0.1:11434/v1" })?.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(resolveModel("ollama", "llama3.2", { baseUrl: "https://example.com/v1" })).toBeNull();
  });

  it("rejects remote URLs before local model catalog fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch should stay unused"));
    try {
      await expect(fetchLocalConnectorModels("https://example.com/v1")).resolves.toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("keeps provider calls free of erased never casts", () => {
    const files = [
      "src/main/model-resolver.ts",
      "src/main/connector-health-service.ts",
      "src/main/credentials/credential-resolver.ts",
    ];

    for (const file of files) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      expect(source).not.toContain("provider as never");
      expect(source).not.toContain("definition.provider as never");
    }
  });
});
