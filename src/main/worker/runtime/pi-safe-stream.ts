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

type SafePiStreamSourceWithEnv = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
  envPatch?: Readonly<Record<string, string>>,
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

let scopedEnvChain: Promise<void> = Promise.resolve();

function hasEnvPatch(envPatch: Readonly<Record<string, string>> | undefined): envPatch is Readonly<Record<string, string>> {
  return !!envPatch && Object.keys(envPatch).length > 0;
}

async function withProcessEnvPatch(
  envPatch: Readonly<Record<string, string>>,
  task: () => Promise<void>,
): Promise<void> {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(envPatch)) {
    saved.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    await task();
  } finally {
    for (const [key, previous] of saved) {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  }
}

function runWithScopedEnv(
  envPatch: Readonly<Record<string, string>> | undefined,
  task: () => Promise<void>,
): Promise<void> {
  if (!hasEnvPatch(envPatch)) return task();
  const run = scopedEnvChain.then(
    () => withProcessEnvPatch(envPatch, task),
    () => withProcessEnvPatch(envPatch, task),
  );
  scopedEnvChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function pipeSourceStream(
  source: PiStreamSource,
  target: AssistantMessageEventStream,
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): Promise<void> {
  const sourceStream = await source(model, context, options);
  for await (const event of sourceStream) {
    target.push(event);
  }
  target.end();
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
  const scoped = createSafePiStreamWithEnv(source, gate);
  return (model, context, options) => scoped(model, context, options);
}

export function createSafePiStreamWithEnv(
  source: PiStreamSource,
  gate?: CredentialConcurrencyGate,
): SafePiStreamSourceWithEnv {
  return (model, context, options, envPatch) => {
    const target = createAssistantMessageEventStream();
    const apiKey = typeof options?.apiKey === "string" ? options.apiKey : "";
    const acquireSlot = gate && apiKey
      ? () => gate.acquire(model.provider, apiKey, options?.signal)
      : () => Promise.resolve<() => void>(() => undefined);
    void Promise.resolve()
      .then(acquireSlot)
      .then(async (release) => {
        try {
          await runWithScopedEnv(envPatch, () => pipeSourceStream(source, target, model, context, options));
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
export const safeStreamSimpleWithEnv = createSafePiStreamWithEnv(streamSimple, defaultGate);
