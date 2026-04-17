import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { getModel, streamSimple } from "@mariozechner/pi-ai";
import { createCodingTools } from "@mariozechner/pi-coding-agent";
import type { RunStatus } from "@shared/types";
import type { ChildMessage, RunJob } from "./worker-helpers";
import { applyEnvOverrides, buildRedactor } from "./worker-helpers";
import type { WorkerRpcClient } from "./worker-rpc";

interface PrepareRunResult {
  provider: string;
  apiKey: string;
  extraEnv: Record<string, string>;
  priorMessages: AgentMessage[];
}

interface RunnerDeps {
  post: (message: ChildMessage) => void;
  rpc: WorkerRpcClient;
  isCancelled: (runId: string) => boolean;
}

export class WorkerRunner {
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(private readonly deps: RunnerDeps) {}

  cancel(runId: string): void {
    const controller = this.abortControllers.get(runId);
    if (controller) controller.abort();
  }

  cancelAll(): void {
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.abortControllers.clear();
  }

  async run(job: RunJob): Promise<void> {
    const { post, rpc, isCancelled } = this.deps;
    const redact = buildRedactor(job.env);
    const abortController = new AbortController();
    this.abortControllers.set(job.runId, abortController);

    post({ type: "run-status", runId: job.runId, status: "running", message: `Running agent ${job.agentName}.` });

    let resolvedModelId: string | null = job.model;
    let finalUsage: { inputTokens: number | null; outputTokens: number | null; costUsd: number | null } = {
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
    };
    let errorMessage: string | null = null;

    try {
      if (!job.model) {
        throw new Error(`Run ${job.runId} has no model selected.`);
      }

      const prepareResponse = await rpc.invoke(job.runId, "prepareRun", {
        connectorId: job.connectorId,
        taskSessionId: job.taskSessionId,
        agentId: job.agentId,
        companyId: job.companyId,
        taskId: job.taskId,
        modelId: job.model,
      });
      if (!prepareResponse.ok) {
        throw new Error(prepareResponse.error);
      }
      const prepared = prepareResponse.result as PrepareRunResult;

      const restoreEnv = applyEnvOverrides(prepared.extraEnv);
      try {
        const model = getModel(prepared.provider as never, job.model as never);
        resolvedModelId = model.id;

        const cwd = job.workspacePath ?? process.cwd();
        const tools = createCodingTools(cwd) as never;

        const agent = new Agent({
          initialState: {
            systemPrompt: job.systemPrompt ?? "",
            model,
            tools,
            messages: prepared.priorMessages,
          },
          streamFn: (m, messages, options) =>
            streamSimple(m, messages, { ...options, apiKey: prepared.apiKey }),
          beforeToolCall: async (context) => {
            const verdict = await rpc.invoke(job.runId, "beforeToolCall", {
              agentId: job.agentId,
              companyId: job.companyId,
              taskId: job.taskId,
              toolCallId: context.toolCall.id,
              toolName: context.toolCall.name,
              args: context.args,
            });
            if (verdict.ok) {
              return verdict.result as { block?: boolean; reason?: string } | undefined;
            }
            return { block: true, reason: verdict.error };
          },
          afterToolCall: async (context) => {
            await rpc.invoke(job.runId, "afterToolCall", {
              toolCallId: context.toolCall.id,
              toolName: context.toolCall.name,
              isError: context.isError,
            });
            return undefined;
          },
        });

        const unsubscribe = agent.subscribe(async (event) => {
          const timestamp = new Date().toISOString();
          post({
            type: "agent-event",
            runId: job.runId,
            agentId: job.agentId,
            companyId: job.companyId,
            taskId: job.taskId,
            emittedAt: timestamp,
            event: event as { type: string } & Record<string, unknown>,
          });

          if (event.type === "message_end" && event.message) {
            await rpc.invoke(job.runId, "persistMessage", {
              taskSessionId: job.taskSessionId,
              message: event.message,
            });
            const maybeAssistant = event.message as { role?: string; usage?: { input?: number; output?: number; cost?: { total?: number } } };
            if (maybeAssistant.role === "assistant" && maybeAssistant.usage) {
              finalUsage = {
                inputTokens: typeof maybeAssistant.usage.input === "number" ? maybeAssistant.usage.input : finalUsage.inputTokens,
                outputTokens: typeof maybeAssistant.usage.output === "number" ? maybeAssistant.usage.output : finalUsage.outputTokens,
                costUsd: typeof maybeAssistant.usage.cost?.total === "number" ? maybeAssistant.usage.cost.total : finalUsage.costUsd,
              };
            }
          }
        });

        try {
          const userMessage = job.taskTitle
            ? `${job.taskTitle}\n\n${job.taskDescription ?? ""}`.trim()
            : (job.taskDescription ?? "");
          const promptContent = userMessage.length > 0 ? userMessage : "Continue.";
          const promptMessage: AgentMessage = {
            role: "user",
            content: [{ type: "text", text: promptContent }],
            timestamp: Date.now(),
          };
          const runPromise = agent.prompt(promptMessage);
          abortController.signal.addEventListener("abort", () => agent.abort(), { once: true });
          await runPromise;
        } finally {
          unsubscribe();
        }
      } finally {
        restoreEnv();
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      post({ type: "run-log", runId: job.runId, stream: "stderr", chunk: redact(errorMessage) });
    } finally {
      this.abortControllers.delete(job.runId);
    }

    const status: RunStatus = isCancelled(job.runId)
      ? "cancelled"
      : errorMessage
        ? "failed"
        : "succeeded";

    post({
      type: "run-finished",
      runId: job.runId,
      status,
      summary: null,
      errorMessage,
      exitCode: null,
      signal: null,
      model: resolvedModelId,
      sessionParams: job.sessionParams,
      sessionDisplayId: null,
      costUsd: finalUsage.costUsd,
      unattributedCost: finalUsage.costUsd === null,
      inputTokens: finalUsage.inputTokens,
      outputTokens: finalUsage.outputTokens,
    });
  }
}
