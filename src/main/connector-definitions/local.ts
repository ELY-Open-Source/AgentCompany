/**
 * Local pi-mono connectors.
 *
 * Ollama and LM Studio both expose an OpenAI-compatible
 * `/v1/chat/completions` endpoint, so they are routed through pi-ai's
 * `openai-completions` API path with a per-installation `baseUrl` that
 * the user enters during onboarding. The provider ids are deliberately
 * absent from `@mariozechner/pi-ai`'s `KnownProvider` set — model
 * dispatch resolves them locally via `src/main/model-resolver.ts` the
 * same way `fireworks` and `fireworks-firepass` do.
 *
 * No environment variable name accompanies the auth descriptor: a local
 * server's address is a user choice, never read from `process.env`.
 */

import type { ConnectorDefinition } from "../connector-definitions";

export const LOCAL_CONNECTORS: ConnectorDefinition[] = [
  {
    id: "ollama",
    provider: "ollama",
    label: "Ollama",
    description:
      "Local Ollama server (https://ollama.com) — runs open-weights models on your own machine through its OpenAI-compatible endpoint.",
    defaultModel: "llama3.2",
    auth: { type: "local", defaultBaseUrl: "http://localhost:11434/v1" },
    notes:
      "Ollama exposes /v1/chat/completions and /v1/models. The default port is 11434; override with a loopback or private-network address.",
  },
  {
    id: "lm-studio",
    provider: "lm-studio",
    label: "LM Studio",
    description:
      "Local LM Studio server (https://lmstudio.ai) — host any loaded model through its OpenAI-compatible endpoint.",
    defaultModel: "local-model",
    auth: { type: "local", defaultBaseUrl: "http://localhost:1234/v1" },
    notes:
      "Enable LM Studio's local server from the Developer tab; the default port is 1234. Use a loopback or private-network address.",
  },
];
