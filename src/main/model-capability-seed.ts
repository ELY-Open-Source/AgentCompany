import type { ModelCapability } from "@shared/types";
import { CONNECTORS } from "./connector-definitions";
import { resolveModel, resolveModelCostFallback, resolveModels } from "./model-resolver";

type ModelCapabilitySeedRow = Omit<ModelCapability, "updatedAt">;
type CapabilityProfile = Pick<ModelCapabilitySeedRow, "reasoning" | "coding" | "writing" | "tier">;
type CatalogModel = { id: string; name: string };

const DEFAULT_COST_PER_MTOK_OUT = 1;

const CURATED_MODEL_CAPABILITY_SEED: ModelCapabilitySeedRow[] = [
  {
    provider: "anthropic",
    modelId: "claude-opus-4-7",
    reasoning: 5,
    coding: 5,
    writing: 5,
    tier: "hard",
    costPerMtokOut: 75,
  },
  {
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    reasoning: 4,
    coding: 5,
    writing: 5,
    tier: "standard",
    costPerMtokOut: 15,
  },
  {
    provider: "anthropic",
    modelId: "claude-haiku-4-5-20251001",
    reasoning: 3,
    coding: 4,
    writing: 4,
    tier: "standard",
    costPerMtokOut: 5,
  },
  {
    provider: "openai",
    modelId: "gpt-5",
    reasoning: 5,
    coding: 4,
    writing: 3,
    tier: "hard",
    costPerMtokOut: 60,
  },
  {
    provider: "openai",
    modelId: "gpt-5-mini",
    reasoning: 4,
    coding: 3,
    writing: 3,
    tier: "standard",
    costPerMtokOut: 10,
  },
  {
    provider: "openai",
    modelId: "gpt-4o-mini",
    reasoning: 3,
    coding: 3,
    writing: 3,
    tier: "standard",
    costPerMtokOut: 2,
  },
  {
    provider: "fireworks",
    modelId: "accounts/fireworks/models/kimi-k2-instruct",
    reasoning: 4,
    coding: 4,
    writing: 5,
    tier: "standard",
    costPerMtokOut: 3,
  },
  {
    provider: "fireworks-firepass",
    modelId: "accounts/fireworks/routers/kimi-k2p6-turbo",
    reasoning: 4,
    coding: 4,
    writing: 5,
    tier: "standard",
    costPerMtokOut: 3,
  },
  {
    provider: "fireworks",
    modelId: "accounts/fireworks/models/glm-4p5",
    reasoning: 3,
    coding: 3,
    writing: 4,
    tier: "standard",
    costPerMtokOut: 2,
  },
  {
    provider: "fireworks",
    modelId: "accounts/fireworks/models/qwen3-coder-480b-a35b-instruct",
    reasoning: 3,
    coding: 5,
    writing: 3,
    tier: "standard",
    costPerMtokOut: 3,
  },
  {
    provider: "fireworks",
    modelId: "accounts/fireworks/models/deepseek-v3p1",
    reasoning: 4,
    coding: 4,
    writing: 3,
    tier: "standard",
    costPerMtokOut: 2,
  },
  {
    provider: "fireworks",
    modelId: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    reasoning: 2,
    coding: 2,
    writing: 2,
    tier: "trivial",
    costPerMtokOut: 1,
  },
];

const CURATED_MODEL_CAPABILITY_BY_KEY = new Map(
  CURATED_MODEL_CAPABILITY_SEED.map((row) => [capabilityKey(row.provider, row.modelId), row]),
);

function capabilityKey(provider: string, modelId: string): string {
  return `${provider}::${modelId}`;
}

function profile(reasoning: number, coding: number, writing: number, tier: CapabilityProfile["tier"]): CapabilityProfile {
  return { reasoning, coding, writing, tier };
}

function searchableText(provider: string, model: CatalogModel): string {
  return `${provider} ${model.id} ${model.name}`.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function hasWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`).test(text);
}

function selectCapabilityProfile(text: string): CapabilityProfile {
  if (text.includes("claude") && text.includes("opus")) return profile(5, 5, 5, "hard");
  if (text.includes("claude") && text.includes("sonnet")) return profile(4, 5, 5, "standard");
  if (text.includes("claude") && text.includes("haiku")) return profile(3, 4, 4, "standard");

  if (text.includes("gpt 5") && text.includes("codex")) return profile(5, 5, 3, "hard");
  if (hasAny(text, ["gpt 5", "gpt 4", "gpt 4o", "o3", "o4"])) return profile(5, 4, 3, "hard");
  if (text.includes("gpt oss 120b")) return profile(4, 4, 3, "standard");
  if (text.includes("gpt oss")) return profile(3, 3, 3, "standard");

  if (text.includes("gemini") && hasAny(text, ["pro", "ultra"])) return profile(5, 4, 4, "hard");
  if (text.includes("gemini")) return profile(3, 3, 3, "standard");

  if (text.includes("grok 4") || text.includes("grok 3")) return profile(5, 4, 4, "hard");
  if (text.includes("grok")) return profile(4, 3, 4, "standard");

  if (hasAny(text, ["glm 5", "zai glm 5"])) return profile(5, 4, 4, "hard");
  if (hasAny(text, ["glm 4 7", "glm 4 6", "zai glm 4 7"])) return profile(4, 4, 4, "standard");
  if (hasAny(text, ["glm 4 5", "glm 4p5"])) return profile(3, 3, 4, "standard");

  if (text.includes("kimi") && text.includes("thinking")) return profile(5, 4, 5, "hard");
  if (text.includes("kimi")) return profile(4, 4, 5, "standard");

  if (text.includes("deepseek") && hasAny(text, ["r1", "reasoner"])) return profile(5, 4, 3, "hard");
  if (hasAny(text, ["deepseek", "deepresearch", "qwq", "thinking"])) return profile(4, 4, 3, "standard");

  if (text.includes("coder") || text.includes("codestral") || text.includes("devstral")) return profile(3, 5, 3, "standard");
  if (text.includes("qwen")) return profile(4, 4, 3, "standard");

  if (text.includes("minimax") || text.includes("mimo")) return profile(3, 4, 4, "standard");
  if (hasAny(text, ["mistral large", "mistral medium", "magistral"])) return profile(4, 4, 4, "standard");
  if (text.includes("mistral") || text.includes("ministral")) return profile(3, 3, 3, "standard");

  if (text.includes("nova premier") || text.includes("nova pro")) return profile(4, 3, 3, "standard");
  if (text.includes("nova")) return profile(2, 2, 2, "trivial");

  if (text.includes("llama 4") || text.includes("llama 70b") || text.includes("llama v3p3 70b")) {
    return profile(3, 3, 3, "standard");
  }
  if (text.includes("llama")) return profile(2, 2, 2, "trivial");

  return profile(3, 3, 3, "standard");
}

function applySizeAdjustment(selected: CapabilityProfile, text: string): CapabilityProfile {
  if (hasWord(text, "nano") || hasWord(text, "micro") || hasWord(text, "3b") || hasWord(text, "7b") || hasWord(text, "8b")) {
    return profile(2, 2, 2, "trivial");
  }

  if (
    hasWord(text, "mini") ||
    hasWord(text, "lite") ||
    hasWord(text, "flash") ||
    hasWord(text, "flashx") ||
    hasWord(text, "air") ||
    hasWord(text, "small") ||
    hasWord(text, "instant") ||
    text.includes("compound mini")
  ) {
    return profile(
      Math.min(selected.reasoning, 3),
      Math.min(selected.coding, 3),
      Math.min(selected.writing, 3),
      selected.tier === "trivial" ? "trivial" : "standard",
    );
  }

  return selected;
}

function inferCapabilityProfile(provider: string, model: CatalogModel): CapabilityProfile {
  const text = searchableText(provider, model);
  return applySizeAdjustment(selectCapabilityProfile(text), text);
}

function normalizeCost(value: number): number {
  if (!Number.isFinite(value) || value < 0) return DEFAULT_COST_PER_MTOK_OUT;
  return Number(value.toFixed(4));
}

function resolveCatalogCostPerMtokOut(provider: string, modelId: string): number {
  const resolved = resolveModel(provider, modelId);
  if (!resolved) return DEFAULT_COST_PER_MTOK_OUT;
  const priced = resolveModelCostFallback(resolved, provider);
  return normalizeCost(priced.cost.output);
}

export function deriveModelCapabilitySeed(provider: string, model: CatalogModel): ModelCapabilitySeedRow {
  const curated = CURATED_MODEL_CAPABILITY_BY_KEY.get(capabilityKey(provider, model.id));
  const selectedProfile = curated ?? inferCapabilityProfile(provider, model);
  return {
    provider,
    modelId: model.id,
    reasoning: selectedProfile.reasoning,
    coding: selectedProfile.coding,
    writing: selectedProfile.writing,
    tier: selectedProfile.tier,
    costPerMtokOut: resolveCatalogCostPerMtokOut(provider, model.id),
  };
}

function listStaticCatalogModels(): Array<{ provider: string; model: CatalogModel }> {
  const modelsByKey = new Map<string, { provider: string; model: CatalogModel }>();

  for (const connector of CONNECTORS) {
    for (const model of resolveModels(connector.provider)) {
      modelsByKey.set(capabilityKey(connector.provider, model.id), {
        provider: connector.provider,
        model: { id: model.id, name: model.name },
      });
    }

    if (connector.auth.type !== "local" && connector.defaultModel.trim()) {
      modelsByKey.set(capabilityKey(connector.provider, connector.defaultModel), {
        provider: connector.provider,
        model: { id: connector.defaultModel, name: connector.defaultModel },
      });
    }
  }

  return Array.from(modelsByKey.values());
}

export function buildModelCapabilitySeed(): ModelCapabilitySeedRow[] {
  const rowsByKey = new Map<string, ModelCapabilitySeedRow>();

  for (const row of CURATED_MODEL_CAPABILITY_SEED) {
    rowsByKey.set(capabilityKey(row.provider, row.modelId), row);
  }

  for (const entry of listStaticCatalogModels()) {
    rowsByKey.set(capabilityKey(entry.provider, entry.model.id), deriveModelCapabilitySeed(entry.provider, entry.model));
  }

  return Array.from(rowsByKey.values()).sort((a, b) => {
    const providerOrder = a.provider.localeCompare(b.provider);
    if (providerOrder !== 0) return providerOrder;
    return a.modelId.localeCompare(b.modelId);
  });
}

export const MODEL_CAPABILITY_SEED: ModelCapabilitySeedRow[] = buildModelCapabilitySeed();
