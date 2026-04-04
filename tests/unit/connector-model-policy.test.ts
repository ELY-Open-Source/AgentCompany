import { describe, expect, it } from "vitest";
import { getConnectorModelPolicy, validateConnectorModelSelection } from "@main/connector-model-policy";
import { getConnectorDefinition } from "@main/connectors";

function createDeps(overrides: {
  connectorModel?: string | null;
  disabledModels?: Array<{ id: string; label: string }>;
} = {}) {
  return {
    getConnector: () => ({
      id: "claude_compatible" as const,
      label: "Claude Compatible",
      model: overrides.connectorModel ?? "model-alpha,model-beta,model-gamma",
    }),
    getDisabledModels: () => overrides.disabledModels ?? [],
  };
}

describe("connector model policy", () => {
  it("derives enabled compat models from connector config minus disabled entries", () => {
    const policy = getConnectorModelPolicy(
      createDeps({ disabledModels: [{ id: "model-beta", label: "model-beta" }] }),
      "claude_compatible",
    );

    expect(policy.enabledModels.map((model) => model.id)).toEqual(["model-alpha", "model-gamma"]);
  });

  it("accepts an explicit enabled model", () => {
    const result = validateConnectorModelSelection(createDeps(), "claude_compatible", "model-alpha");

    expect(result).toEqual({ ok: true, effectiveModel: "model-alpha" });
  });

  it("rejects an explicit disabled model", () => {
    const result = validateConnectorModelSelection(
      createDeps({ disabledModels: [{ id: "model-beta", label: "model-beta" }] }),
      "claude_compatible",
      "model-beta",
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected explicit disabled model to be rejected.");
    }
    expect(result.error).toContain('does not allow model "model-beta"');
  });
});

describe("native connector defaults", () => {
  it("uses the persisted connector model as the native default when configured", () => {
    const codexModels = getConnectorDefinition("codex_local").module.models ?? [];
    const configuredDefault = codexModels[1]?.id;

    if (!configuredDefault) {
      throw new Error("codex_local requires at least two models for this default policy test.");
    }

    const policy = getConnectorModelPolicy({
      getConnector: () => ({
        id: "codex_local" as const,
        label: "Codex",
        model: configuredDefault,
      }),
      getDisabledModels: () => [],
    }, "codex_local");

    expect(policy.defaultModel).toBe(configuredDefault);
    expect(validateConnectorModelSelection({
      getConnector: () => ({
        id: "codex_local" as const,
        label: "Codex",
        model: configuredDefault,
      }),
      getDisabledModels: () => [],
    }, "codex_local", null)).toEqual({
      ok: true,
      effectiveModel: configuredDefault,
    });
  });
});
