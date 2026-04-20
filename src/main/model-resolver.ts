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
import { getModel, getModels, type Api, type Model } from "@mariozechner/pi-ai";

// Fireworks' OpenAI-compatible root. The OpenAI SDK appends
// `/chat/completions`, `/models`, etc. to this baseURL.
const FIREWORKS_OPENAI_BASE_URL = "https://api.fireworks.ai/inference/v1";
const FIREWORKS_DEFAULT_CONTEXT = 128_000;
const FIREWORKS_DEFAULT_MAX_TOKENS = 8192;

export const FIREWORKS_FIREPASS_MODEL_ID = "accounts/fireworks/models/kimi-k2.5-turbo";
export const FIREWORKS_FIREPASS_MODEL_NAME = "Kimi K2.5 Turbo (Fire Pass)";

const FIREWORKS_CURATED_MODELS: Array<{ id: string; name: string; contextWindow?: number }> = [
  { id: "accounts/fireworks/models/kimi-k2-instruct", name: "Kimi K2 Instruct", contextWindow: 131_072 },
  { id: "accounts/fireworks/models/qwen3-coder-480b-a35b-instruct", name: "Qwen3 Coder 480B A35B Instruct", contextWindow: 262_144 },
  { id: "accounts/fireworks/models/deepseek-v3p1", name: "DeepSeek V3.1", contextWindow: 163_840 },
  { id: "accounts/fireworks/models/glm-4p5", name: "GLM 4.5", contextWindow: 131_072 },
  { id: "accounts/fireworks/models/llama-v3p3-70b-instruct", name: "Llama 3.3 70B Instruct", contextWindow: 131_072 },
];

function buildFireworksModel(modelId: string, name?: string, contextWindow?: number): Model<"openai-completions"> {
  return {
    id: modelId,
    name: name ?? modelId,
    api: "openai-completions",
    provider: "fireworks",
    baseUrl: FIREWORKS_OPENAI_BASE_URL,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: contextWindow ?? FIREWORKS_DEFAULT_CONTEXT,
    maxTokens: FIREWORKS_DEFAULT_MAX_TOKENS,
  };
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
  } catch (err) {
    log.warn(`[model-resolver] getModel failed for ${provider}/${modelId}:`, err instanceof Error ? err.message : String(err));
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
