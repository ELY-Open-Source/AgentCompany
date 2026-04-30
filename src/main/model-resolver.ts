/**
 * Resolves `Model<Api>` and the dynamic stream headers needed for providers
 * that pi-ai's catalog does not ship out of the box.
 *
 * Today this only covers the two Fireworks connectors (`fireworks` and
 * `fireworks-firepass`). Fireworks is not a built-in pi-ai provider, so we
 * route them through pi-ai's native `openai-completions` API against
 * Fireworks' OpenAI-compatible endpoint. The earlier shim pointed the
 * Anthropic SDK at Fireworks' `/v1/messages` path, which forced pi-ai to
 * ship Claude-proprietary beta headers (`fine-grained-tool-streaming-*`,
 * `anthropic-dangerous-direct-browser-access`, etc.) — Fireworks tolerates
 * them inconsistently and the resulting streams frequently close with no
 * tokens emitted, producing runs that report "succeeded" but did
 * absolutely nothing. The OpenAI-compatible endpoint at
 * `https://api.fireworks.ai/inference/v1` does not suffer the same
 * problem and is the path Fireworks documents for tool-using clients.
 */

import log from "electron-log/main.js";
import { getModels, type Api, type Model } from "@mariozechner/pi-ai";
import { isPiKnownProvider } from "./connectors";

// Fireworks' OpenAI-compatible root. The OpenAI SDK appends
// `/chat/completions`, `/models`, etc. to this baseURL.
const FIREWORKS_OPENAI_BASE_URL = "https://api.fireworks.ai/inference/v1";
const FIREWORKS_DEFAULT_CONTEXT = 128_000;
const FIREWORKS_DEFAULT_MAX_TOKENS = 8192;

// Fire Pass routes subscription traffic through a dedicated router id,
// not the per-token model path. The canonical identifier is documented
// at https://docs.fireworks.ai/firepass and applies to both the
// OpenAI-compatible (`/inference/v1`) and Anthropic-compatible
// (`/inference`) endpoints. Do not "align" this to the
// `accounts/fireworks/models/...` id — the subscription entitlement
// only attaches to the router route, and switching to the model path
// makes Fireworks bill per-token and reject Fire-Pass-only callers.
export const FIREWORKS_FIREPASS_MODEL_ID = "accounts/fireworks/routers/kimi-k2p5-turbo";
export const FIREWORKS_FIREPASS_MODEL_NAME = "Kimi K2.5 Turbo (Fire Pass)";

const FIREWORKS_CURATED_MODELS: Array<{
  id: string;
  name: string;
  contextWindow?: number;
  cost: { input: number; output: number };
}> = [
  { id: "accounts/fireworks/models/kimi-k2-instruct", name: "Kimi K2 Instruct", contextWindow: 131_072, cost: { input: 0.50, output: 0.50 } },
  { id: "accounts/fireworks/models/qwen3-coder-480b-a35b-instruct", name: "Qwen3 Coder 480B A35B Instruct", contextWindow: 262_144, cost: { input: 0.50, output: 0.50 } },
  { id: "accounts/fireworks/models/deepseek-v3p1", name: "DeepSeek V3.1", contextWindow: 163_840, cost: { input: 0.20, output: 0.20 } },
  { id: "accounts/fireworks/models/glm-4p5", name: "GLM 4.5", contextWindow: 131_072, cost: { input: 0.30, output: 0.30 } },
  { id: "accounts/fireworks/models/llama-v3p3-70b-instruct", name: "Llama 3.3 70B Instruct", contextWindow: 131_072, cost: { input: 0.20, output: 0.20 } },
];

const FIREWORKS_FIREPASS_COST = { input: 0, output: 0 };
const FIREWORKS_FALLBACK_COST = { input: 0.50, output: 0.50 };

function buildFireworksModel(
  modelId: string,
  name?: string,
  contextWindow?: number,
  cost?: { input: number; output: number },
): Model<"openai-completions"> {
  const modelCost = cost ?? FIREWORKS_FALLBACK_COST;
  return {
    id: modelId,
    name: name ?? modelId,
    api: "openai-completions",
    provider: "fireworks",
    baseUrl: FIREWORKS_OPENAI_BASE_URL,
    reasoning: false,
    input: ["text"],
    cost: { input: modelCost.input, output: modelCost.output, cacheRead: 0, cacheWrite: 0 },
    contextWindow: contextWindow ?? FIREWORKS_DEFAULT_CONTEXT,
    maxTokens: FIREWORKS_DEFAULT_MAX_TOKENS,
  };
}

export function resolveModel(provider: string, modelId: string): Model<Api> | null {
  if (provider === "fireworks-firepass") {
    return buildFireworksModel(FIREWORKS_FIREPASS_MODEL_ID, FIREWORKS_FIREPASS_MODEL_NAME, 262_144, FIREWORKS_FIREPASS_COST);
  }
  if (provider === "fireworks") {
    const curated = FIREWORKS_CURATED_MODELS.find((entry) => entry.id === modelId);
    return buildFireworksModel(modelId, curated?.name, curated?.contextWindow, curated?.cost);
  }
  if (!isPiKnownProvider(provider)) {
    log.warn(`[model-resolver] Unknown pi provider: ${provider}`);
    return null;
  }
  try {
    return getModels(provider).find((model) => model.id === modelId) ?? null;
  } catch (err) {
    log.warn(`[model-resolver] getModel failed for ${provider}/${modelId}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

const CROSS_PROVIDER_COST_LOOKUP: Record<string, string[]> = {
  "github-copilot": ["anthropic", "openai", "google", "xai"],
  "google-gemini-cli": ["google"],
};

const PROVIDER_FALLBACK_COST: Record<string, { input: number; output: number }> = {
  "zai": { input: 1, output: 3.2 },
  "kimi-coding": { input: 0.6, output: 3 },
};

function normalizeModelId(id: string): string {
  return id.replace(/\./g, "-");
}

export function resolveModelCostFallback(model: Model<Api>, provider: string): Model<Api> {
  if (model.cost.input > 0 || model.cost.output > 0) return model;

  const crossProviders = CROSS_PROVIDER_COST_LOOKUP[provider];
  if (crossProviders) {
    const normalized = normalizeModelId(model.id);
    for (const cp of crossProviders) {
      try {
        const sourceModels = getModels(cp as Parameters<typeof getModels>[0]);
        const match = sourceModels.find((m) => m.id === model.id)
          ?? sourceModels.find((m) => normalizeModelId(m.id) === normalized)
          ?? sourceModels.find((m) => normalized.includes(normalizeModelId(m.id)) || normalizeModelId(m.id).includes(normalized));
        if (match && (match.cost.input > 0 || match.cost.output > 0)) {
          return { ...model, cost: { ...match.cost } };
        }
      } catch {
        continue;
      }
    }
  }

  const fallback = PROVIDER_FALLBACK_COST[provider];
  if (fallback) {
    return { ...model, cost: { ...model.cost, input: fallback.input, output: fallback.output } };
  }

  return model;
}

export function resolveModels(provider: string): Array<{ id: string; name: string }> {
  if (provider === "fireworks-firepass") {
    return [{ id: FIREWORKS_FIREPASS_MODEL_ID, name: FIREWORKS_FIREPASS_MODEL_NAME }];
  }
  if (provider === "fireworks") {
    return FIREWORKS_CURATED_MODELS.map(({ id, name }) => ({ id, name }));
  }
  if (!isPiKnownProvider(provider)) {
    log.warn(`[model-resolver] Unknown pi provider: ${provider}`);
    return [];
  }
  try {
    const models = getModels(provider);
    return models.map((model: { id: string; name?: string }) => ({ id: model.id, name: model.name ?? model.id }));
  } catch (err) {
    log.warn(`[model-resolver] getModels failed for ${provider}:`, err instanceof Error ? err.message : String(err));
    return [];
  }
}

/**
 * Extra HTTP headers that must be merged into the streamSimple call for the
 * given provider. Returns undefined when no extra headers are required.
 *
 * Fireworks' OpenAI-compatible endpoint authenticates via the OpenAI
 * SDK's native `apiKey` constructor — it already sends
 * `Authorization: Bearer <apiKey>`. No per-provider header injection is
 * needed; the helper stays in place as an extension point for future
 * providers that do require hand-built headers.
 */
export function resolveExtraStreamHeaders(_provider: string, _apiKey: string): Record<string, string> | undefined {
  return undefined;
}
