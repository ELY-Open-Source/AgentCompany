import type { Agent, AgentMessage } from "@mariozechner/pi-agent-core";
import { resolveModel, resolveExtraStreamHeaders } from "../../model-resolver";
import type { RunStatus } from "@shared/types";
import type { ChildMessage, RunJob } from "./helpers";
import { buildRedactor } from "./helpers";
import { createPiAgent, resolveThinkingLevel, type ErasedAgentTool } from "./pi-agent-factory";
import type { WorkerRpcClient } from "../entry/rpc";
import { createHireAgentTool, HIRE_AGENT_TOOL_NAME } from "./internal-tools/hire-agent-tool";
import { createFileApprovalTool, FILE_APPROVAL_TOOL_NAME } from "./internal-tools/file-approval-tool";
import { createRunScopedCodingTools, mergeRunEnvs } from "./run-tools";
import {
  classifyRunUsage,
  hasAttributableAssistantUsage,
  isTerminalAssistantStopReason,
  type TerminalAssistantStopReason,
} from "../../run-usage-status";

interface PrepareRunResult {
  provider: string;
  apiKey: string;
  extraEnv: Record<string, string>;
  /** OpenAI-compatible server base URL for local connectors (Ollama, LM Studio). */
  baseUrl: string | null;
  priorMessages: AgentMessage[];
}

interface RunnerDeps {
  post: (message: ChildMessage) => void;
  rpc: WorkerRpcClient;
  isCancelled: (runId: string) => boolean;
}

/**
 * Lifecycle owner for one-and-only-one active pi `Agent` per run.
 *
 * Responsibilities:
 *  - Calls `prepareRun` on main to materialise session + credentials.
 *  - Builds an `Agent` via `createPiAgent` with the full Pi contract.
 *  - Streams every pi `AgentEvent` into the worker → main pipe.
 *  - Persists each `message_end` message through `persistMessage` RPC.
 *  - Exposes `steer` to the worker entry so mid-run injections from
 *    main land on the in-process Agent instance.
 *  - Publishes `run-agent-state` transitions so main can tell whether
 *    an active run is actually ready to accept steer messages.
 */
export class WorkerRunner {
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly runPromises = new Map<string, Promise<void>>();
  private readonly activeAgents = new Map<string, Agent>();

  constructor(private readonly deps: RunnerDeps) {}

  cancel(runId: string): void {
    const controller = this.abortControllers.get(runId);
    if (controller) controller.abort();
  }

  /**
   * Enqueue a steering message onto the active Agent for this run. Returns
   * true iff the Agent instance exists in `activeAgents` and the message
   * was appended to its steering queue. A false return means the run has
   * either not finished construction (pre-`agent_active`) or has already
   * torn down (post-`closing`); callers must treat the steer as rejected
   * so main can hold the inbox `delivered_at` write and fall back to the
   * inbox + wake path instead.
   */
  steer(runId: string, message: AgentMessage): boolean {
    const agent = this.activeAgents.get(runId);
    if (!agent) return false;
    agent.steer(message);
    return true;
  }

  /**
   * Aborts every in-flight run and returns a promise that resolves once
   * each `run()` has settled (success, failure, or abort). Callers (the
   * worker shutdown handler) must `await` this before `process.exit` so
   * pending `persistMessage` RPCs and the final `run-finished` post reach
   * the parent before the worker dies.
   */
  async cancelAll(): Promise<void> {
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    const pending = [...this.runPromises.values()];
    this.abortControllers.clear();
    await Promise.allSettled(pending);
  }

  run(job: RunJob): Promise<void> {
    const promise = this.runImpl(job).finally(() => {
      this.runPromises.delete(job.runId);
    });
    this.runPromises.set(job.runId, promise);
    return promise;
  }

  private async runImpl(job: RunJob): Promise<void> {
    const { post, rpc, isCancelled } = this.deps;
    let redact = buildRedactor(job.env);
    const abortController = new AbortController();
    this.abortControllers.set(job.runId, abortController);

    post({ type: "run-status", runId: job.runId, status: "running", message: `Running agent ${job.agentName}.` });

    let resolvedModelId: string | null = job.model;
    let finalUsage: { inputTokens: number | null; outputTokens: number | null } = {
      inputTokens: null,
      outputTokens: null,
    };
    let sawAttributableUsage = false;
    let terminalStopReason: TerminalAssistantStopReason | null = null;
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
        workspaceId: job.workspaceId ?? null,
        workspacePath: job.workspacePath ?? null,
        workspaceMode: job.workspaceMode,
      });
      if (!prepareResponse.ok) {
        throw new Error(prepareResponse.error);
      }
      const prepared = prepareResponse.result as PrepareRunResult;
      const runEnv = mergeRunEnvs(job.env, prepared.extraEnv);
      redact = buildRedactor(runEnv);

      const model = resolveModel(prepared.provider, job.model, {
        baseUrl: prepared.baseUrl ?? undefined,
      });
      if (!model) {
        throw new Error(`Unknown model ${job.model} for provider ${prepared.provider}.`);
      }
      resolvedModelId = model.id;
      const extraHeaders = resolveExtraStreamHeaders(prepared.provider, prepared.apiKey);

      const cwd = job.workspacePath ?? process.cwd();
      const codingTools = createRunScopedCodingTools(cwd, runEnv);
      const internalTools: ErasedAgentTool[] = [];
      for (const toolName of job.internalTools ?? []) {
        switch (toolName) {
          case HIRE_AGENT_TOOL_NAME:
            internalTools.push(createHireAgentTool(rpc, job.runId));
            break;
          case FILE_APPROVAL_TOOL_NAME:
            internalTools.push(createFileApprovalTool(rpc, job.runId));
            break;
          default: {
            // Exhaustiveness guard: a new entry in the `internalTools`
            // array without a matching case should be a compile-time
            // regression.
            const _exhaustive: never = toolName;
            throw new Error(`Unknown internal tool requested: ${String(_exhaustive)}`);
          }
        }
      }
      const tools: ErasedAgentTool[] = [...codingTools, ...internalTools];

      const agent = createPiAgent({
        runId: job.runId,
        taskSessionId: job.taskSessionId,
        systemPrompt: job.systemPrompt ?? "",
        model,
        tools,
        priorMessages: prepared.priorMessages,
        thinkingLevel: resolveThinkingLevel(job.thinkingEffort),
        apiKey: prepared.apiKey,
        extraHeaders,
        streamEnv: prepared.extraEnv,
        rpc,
        onContextCompaction: (telemetry) => {
          post({
            type: "context-compaction",
            runId: telemetry.runId,
            emittedAt: telemetry.emittedAt,
            estimatedTokens: telemetry.estimatedTokens,
            originalMessageCount: telemetry.originalMessageCount,
            compactedMessageCount: telemetry.compactedMessageCount,
            compactedOlderMessageCount: telemetry.compactedOlderMessageCount,
            retainedRecentMessageCount: telemetry.retainedRecentMessageCount,
          });
        },
      });
      this.activeAgents.set(job.runId, agent);
      post({ type: "run-agent-state", runId: job.runId, state: "agent_active" });

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
          const persistResponse = await rpc.invoke(job.runId, "persistMessage", {
            taskSessionId: job.taskSessionId,
            message: event.message,
          });
          if (!persistResponse.ok) {
            throw new Error(`persistMessage RPC failed: ${persistResponse.error}`);
          }
          const maybeAssistant = event.message as {
            role?: string;
            stopReason?: string;
            errorMessage?: string;
            usage?: { input?: number; output?: number; cost?: { total?: number } };
          };
          if (maybeAssistant.role === "assistant" && isTerminalAssistantStopReason(maybeAssistant.stopReason)) {
            terminalStopReason = maybeAssistant.stopReason;
            errorMessage = maybeAssistant.errorMessage ?? `Agent stopped with ${maybeAssistant.stopReason}.`;
          }
          if (hasAttributableAssistantUsage(maybeAssistant)) {
            sawAttributableUsage = true;
            finalUsage = {
              inputTokens: typeof maybeAssistant.usage.input === "number" ? maybeAssistant.usage.input : finalUsage.inputTokens,
              outputTokens: typeof maybeAssistant.usage.output === "number" ? maybeAssistant.usage.output : finalUsage.outputTokens,
            };
          }
        }
      });

      try {
        const promptContent = job.initialUserTurn.trim();
        if (promptContent.length === 0) {
          throw new Error(`Run ${job.runId} has an empty initial user turn.`);
        }
        const promptMessage: AgentMessage = {
          role: "user",
          content: [{ type: "text", text: promptContent }],
          timestamp: Date.now(),
        };
        const runPromise = agent.prompt(promptMessage);
        abortController.signal.addEventListener("abort", () => agent.abort(), { once: true });
        await runPromise;
      } finally {
        post({ type: "run-agent-state", runId: job.runId, state: "closing" });
        unsubscribe();
        this.activeAgents.delete(job.runId);
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
    const usageStatus = classifyRunUsage({
      runStatus: status,
      errorMessage,
      sawAttributableUsage,
      terminalStopReason,
    });

    post({
      type: "run-finished",
      runId: job.runId,
      status,
      summary: null,
      errorMessage,
      exitCode: null,
      signal: null,
      model: resolvedModelId,
      usageStatus,
      inputTokens: finalUsage.inputTokens,
      outputTokens: finalUsage.outputTokens,
    });
  }
}
