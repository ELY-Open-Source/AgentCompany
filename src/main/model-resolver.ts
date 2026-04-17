/**
 * Resolves `Model<Api>` and the dynamic stream headers needed for providers
 * that pi-ai's catalog does not ship out of the box.
 *
 * Today this only covers the two Fireworks connectors (`fireworks` and
 * `fireworks-firepass`), which both speak the Anthropic-compatible endpoint
 * at `https://api.fireworks.ai/inference` and require Bearer auth. For every
 * other provider we delegate to pi-ai's `getModel` / `getModels`.
 */

import { getModel, getModels, type Api, type Model } from "@mariozechner/pi-ai";

const FIREWORKS_BASE_URL = "https://api.fireworks.ai/inference";
const FIREWORKS_DEFAULT_CONTEXT = 128_000;
const FIREWORKS_DEFAULT_MAX_TOKENS = 8192;

export const FIREWORKS_FIREPASS_MODEL_ID = "accounts/fireworks/routers/kimi-k2p5-turbo";
export const FIREWORKS_FIREPASS_MODEL_NAME = "Kimi K2.5 Turbo (Fire Pass)";

const FIREWORKS_CURATED_MODELS: Array<{ id: string; name: string; contextWindow?: number }> = [
  { id: "accounts/fireworks/models/kimi-k2-instruct", name: "Kimi K2 Instruct", contextWindow: 131_072 },
  { id: "accounts/fireworks/models/qwen3-coder-480b-a35b-instruct", name: "Qwen3 Coder 480B A35B Instruct", contextWindow: 262_144 },
  { id: "accounts/fireworks/models/deepseek-v3p1", name: "DeepSeek V3.1", contextWindow: 163_840 },
  { id: "accounts/fireworks/models/glm-4p5", name: "GLM 4.5", contextWindow: 131_072 },
  { id: "accounts/fireworks/models/llama-v3p3-70b-instruct", name: "Llama 3.3 70B Instruct", contextWindow: 131_072 },
];

function buildFireworksModel(modelId: string, name?: string, contextWindow?: number): Model<"anthropic-messages"> {
  return {
    id: modelId,
    name: name ?? modelId,
    api: "anthropic-messages",
    provider: "fireworks",
    baseUrl: FIREWORKS_BASE_URL,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: contextWindow ?? FIREWORKS_DEFAULT_CONTEXT,
    maxTokens: FIREWORKS_DEFAULT_MAX_TOKENS,
  };
}

function isFireworksProvider(provider: string): boolean {
  return provider === "fireworks" || provider === "fireworks-firepass";
}

export function resolveModel(provider: string, modelId: string): Model<Api> | null {
  if (provider === "fireworks-firepass") {
    return buildFireworksModel(FIREWORKS_FIREPASS_MODEL_ID, FIREWORKS_FIREPASS_MODEL_NAME, 262_144);
  }
  if (provider === "fireworks") {
    const curated = FIREWORKS_CURATED_MODELS.find((entry) => entry.id === modelId);
    return buildFireworksModel(modelId, curated?.name, curated?.contextWindow);
  }
  try {
    return getModel(provider as never, modelId as never) ?? null;
  } catch {
    return null;
  }
}

export function resolveModels(provider: string): Array<{ id: string; name: string }> {
  if (provider === "fireworks-firepass") {
    return [{ id: FIREWORKS_FIREPASS_MODEL_ID, name: FIREWORKS_FIREPASS_MODEL_NAME }];
  }
  if (provider === "fireworks") {
    return FIREWORKS_CURATED_MODELS.map(({ id, name }) => ({ id, name }));
  }
  try {
    const models = getModels(provider as never) ?? [];
    return models.map((model: { id: string; name?: string }) => ({ id: model.id, name: model.name ?? model.id }));
  } catch {
    return [];
  }
}

/**
 * Extra HTTP headers that must be merged into the streamSimple call for the
 * given provider. Returns undefined when no extra headers are required.
 *
 * Fireworks' Anthropic-compat endpoint authenticates via `Authorization: Bearer`,
 * not `x-api-key`. pi-ai's anthropic provider only sends `x-api-key`, so we
 * inject the bearer header at the call site.
 */
export function resolveExtraStreamHeaders(provider: string, apiKey: string): Record<string, string> | undefined {
  if (!apiKey) return undefined;
  if (isFireworksProvider(provider)) {
    return { Authorization: `Bearer ${apiKey}` };
  }
  return undefined;
}
