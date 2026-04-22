import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getProviders } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import {
  CONNECTORS,
  getConnectorKnownProvider,
  getConnectorProvider,
  isLocalModelResolverProvider,
  isPiKnownProvider,
} from "../../src/main/connectors";
import { FIREWORKS_FIREPASS_MODEL_ID, resolveModel, resolveModels } from "../../src/main/model-resolver";

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
