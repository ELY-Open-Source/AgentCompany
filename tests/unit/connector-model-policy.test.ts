import { describe, expect, it } from "vitest";
import { getConnectorModelPolicy, validateConnectorModelSelection } from "@main/connector-model-policy";
import { getConnectorDefinition } from "@main/connectors";

function createDeps(overrides: {
  connectorModel?: string | null;
  disabledModels?: Array<{ id: string; label: string }>;
} = {}) {
  return {
    getConnector: () => ({
      id: "anthropic" as const,
      label: "Anthropic",
      model: overrides.connectorModel ?? null,
    }),
    getDisabledModels: (_c: string, _k: string) => overrides.disabledModels ?? [],
  };
}

describe("connector model policy", () => {
  it("excludes disabled models from the enabled set", () => {
    const policy = getConnectorModelPolicy(createDeps(), "test-co", "anthropic");
    const allIds = policy.enabledModels.map((model) => model.id);
    if (allIds.length === 0) {
      throw new Error("anthropic provider should expose at least one model from pi-ai.");
    }

    const firstModel = allIds[0];
    const filteredPolicy = getConnectorModelPolicy(
      createDeps({ disabledModels: [{ id: firstModel, label: firstModel }] }), "test-co", "anthropic",
    );

    expect(filteredPolicy.enabledModels.some((model) => model.id === firstModel)).toBe(false);
  });

  it("accepts an explicit enabled model", () => {
    const policy = getConnectorModelPolicy(createDeps(), "test-co", "anthropic");
    const enabledId = policy.enabledModels[0]?.id;
    if (!enabledId) {
      throw new Error("anthropic provider should expose at least one model from pi-ai.");
    }
    const result = validateConnectorModelSelection(createDeps(), "test-co", "anthropic", enabledId);

    expect(result).toEqual({ ok: true, effectiveModel: enabledId });
  });

  it("rejects an explicit disabled model", () => {
    const policy = getConnectorModelPolicy(createDeps(), "test-co", "anthropic");
    const enabledId = policy.enabledModels[0]?.id;
    if (!enabledId) {
      throw new Error("anthropic provider should expose at least one model from pi-ai.");
    }
    const result = validateConnectorModelSelection(
      createDeps({ disabledModels: [{ id: enabledId, label: enabledId }] }), "test-co", "anthropic",
      enabledId,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected explicit disabled model to be rejected.");
    }
    expect(result.error).toContain(`does not allow model "${enabledId}"`);
  });
});

describe("native connector defaults", () => {
  it("falls back to definition defaultModel when connector model is empty", () => {
    const definition = getConnectorDefinition("openai-codex");
    const configuredDefault = definition.defaultModel;

    const policy = getConnectorModelPolicy({
      getConnector: () => ({
        id: "openai-codex" as const,
        label: "Codex",
        model: null,
      }),
      getDisabledModels: (_c: string, _k: string) => [],
    }, "test-co", "openai-codex");

    expect(policy.defaultModel).toBe(configuredDefault);
    expect(validateConnectorModelSelection({
      getConnector: () => ({
        id: "openai-codex" as const,
        label: "Codex",
        model: null,
      }),
      getDisabledModels: (_c: string, _k: string) => [],
    }, "test-co", "openai-codex", null)).toEqual({
      ok: true,
      effectiveModel: configuredDefault,
    });
  });
});
