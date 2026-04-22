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

export function createSafePiStream(source: PiStreamSource): SafePiStreamSource {
  return (model, context, options) => {
    const target = createAssistantMessageEventStream();
    void Promise.resolve()
      .then(() => source(model, context, options))
      .then(async (sourceStream) => {
        for await (const event of sourceStream) {
          target.push(event);
        }
        target.end();
      })
      .catch((error) => {
        pushStreamError(target, model, error, options?.signal);
      });
    return target;
  };
}

export const safeStreamSimple = createSafePiStream(streamSimple);
