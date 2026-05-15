import {
  createAssistantMessageEventStream,
  streamSimple,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type StopReason,
  type Usage,
} from "@mariozechner/pi-ai";
import {
  InMemoryCredentialConcurrencyGate,
  type CredentialConcurrencyGate,
} from "./credential-concurrency-gate";
import { getProviderConcurrencyLimit } from "./provider-rate-limits";

type PiStreamSource = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;

type SafePiStreamSource = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

type ErrorAssistantMessage = AssistantMessage & {
  stopReason: Extract<StopReason, "error" | "aborted">;
};

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function formatStreamError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function createStreamErrorMessage(model: Model<Api>, error: unknown, signal?: AbortSignal): ErrorAssistantMessage {
  const stopReason: Extract<StopReason, "error" | "aborted"> = signal?.aborted ? "aborted" : "error";
  return {
    role: "assistant",
    content: [{ type: "text", text: "" }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: EMPTY_USAGE,
    stopReason,
    errorMessage: formatStreamError(error),
    timestamp: Date.now(),
  };
}

function pushStreamError(
  stream: AssistantMessageEventStream,
  model: Model<Api>,
  error: unknown,
  signal?: AbortSignal,
): void {
  const message = createStreamErrorMessage(model, error, signal);
  stream.push({ type: "error", reason: message.stopReason, error: message });
  stream.end(message);
}

/**
 * Build a safe stream wrapper. When `gate` is provided, every call
 * acquires a slot keyed by `(model.provider, options.apiKey)` before
 * the underlying source is invoked, and releases the slot once the
 * stream finishes (success, error, or abort). Calls without an
 * `apiKey` skip the gate — they target keyless transports such as
 * local Ollama / LM Studio.
 */
export function createSafePiStream(
  source: PiStreamSource,
  gate?: CredentialConcurrencyGate,
): SafePiStreamSource {
  return (model, context, options) => {
    const target = createAssistantMessageEventStream();
    const apiKey = typeof options?.apiKey === "string" ? options.apiKey : "";
    const acquireSlot = gate && apiKey
      ? () => gate.acquire(model.provider, apiKey, options?.signal)
      : () => Promise.resolve<() => void>(() => undefined);
    void Promise.resolve()
      .then(acquireSlot)
      .then(async (release) => {
        try {
          const sourceStream = await source(model, context, options);
          for await (const event of sourceStream) {
            target.push(event);
          }
          target.end();
        } finally {
          release();
        }
      })
      .catch((error) => {
        pushStreamError(target, model, error, options?.signal);
      });
    return target;
  };
}

const defaultGate: CredentialConcurrencyGate = new InMemoryCredentialConcurrencyGate(
  getProviderConcurrencyLimit,
);

export const safeStreamSimple = createSafePiStream(streamSimple, defaultGate);
