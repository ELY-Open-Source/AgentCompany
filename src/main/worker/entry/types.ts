import { z } from "zod";
import type { AppDatabase } from "../../database";
import { RUN_USAGE_STATUSES, type DesktopEvent, type RunRecord } from "@shared/types";
import type { NotificationOptions } from "../../notification-service";
import type { createBudgetEnforcementService } from "../../budget-enforcement-service";
import type { createSessionManagementService } from "../../session-management-service";
import type { RuntimeBridge, RuntimeMessageInjector } from "../../agent-runtime";

const runStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "cancelled", "timed_out", "interrupted"]);
const runUsageStatusSchema = z.enum(RUN_USAGE_STATUSES);

/**
 * Single source of truth for worker → main RPC method names.
 *
 * This constant is consumed by both the zod validation schema in this
 * file (the runtime gate at `handleWorkerMessage`) and the `RpcMethod`
 * TypeScript union exported from `agent-runtime/runtime-bridge.ts` via
 * `z.infer`. Adding a new internal RPC requires touching exactly one
 * place — this literal list — which eliminates the C4→C5 hotfix class
 * of bug where the two definitions silently drifted and the zod gate
 * rejected a newly-minted method the handler had already registered.
 */
export const workerRpcMethodSchema = z.enum([
  "persistMessage",
  "prepareRun",
  "beforeToolCall",
  "afterToolCall",
  "invokeInternalTool",
]);

export type WorkerRpcMethod = z.infer<typeof workerRpcMethodSchema>;

export const workerMessageSchema = z.union([
  z.object({
    type: z.literal("run-log"),
    runId: z.string().uuid(),
    stream: z.enum(["stdout", "stderr"]),
    chunk: z.string(),
  }),
  z.object({
    type: z.literal("run-status"),
    runId: z.string().uuid(),
    status: runStatusSchema,
    message: z.string(),
  }),
  z.object({
    type: z.literal("run-finished"),
    runId: z.string().uuid(),
    status: runStatusSchema,
    summary: z.string().nullable(),
    errorMessage: z.string().nullable(),
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
    model: z.string().nullable(),
    usageStatus: runUsageStatusSchema,
    inputTokens: z.number().nullable(),
    outputTokens: z.number().nullable(),
  }).strict(),
  z.object({
    type: z.literal("agent-event"),
    runId: z.string().uuid(),
    agentId: z.string(),
    companyId: z.string(),
    taskId: z.string().nullable(),
    emittedAt: z.string(),
    event: z.record(z.string(), z.unknown()).and(z.object({ type: z.string() })),
  }),
  z.object({
    type: z.literal("context-compaction"),
    runId: z.string().uuid(),
    emittedAt: z.string(),
    estimatedTokens: z.number(),
    originalMessageCount: z.number().int(),
    compactedMessageCount: z.number().int(),
    compactedOlderMessageCount: z.number().int(),
    retainedRecentMessageCount: z.number().int(),
  }),
  z.object({
    type: z.literal("rpc-request"),
    rpcId: z.string(),
    runId: z.string().uuid(),
    method: workerRpcMethodSchema,
    payload: z.unknown(),
  }),
  z.object({
    type: z.literal("run-agent-state"),
    runId: z.string().uuid(),
    state: z.enum(["agent_active", "closing"]),
  }),
  z.object({
    type: z.literal("steer-ack"),
    runId: z.string().uuid(),
    correlationId: z.string(),
    accepted: z.boolean(),
  }),
]);

export interface WorkerServiceDependencies {
  db: AppDatabase;
  logger: {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  workerPath: string;
  isQuitting: () => boolean;
  publishDomainChanged: () => void;
  emitEvent: (event: DesktopEvent) => void;
  wakeAgentIfPossible: (agentId: string | null | undefined, companyId: string, trigger: string) => string | null;
  dispatchRunToWorker: (params: {
    runId: string;
    companyId: string;
    agent: ReturnType<AppDatabase["core"]["entity"]["getAgent"]>;
    task: ReturnType<AppDatabase["core"]["entity"]["getTask"]> | null;
    connector: ReturnType<AppDatabase["core"]["connectors"]["getConnector"]>;
    workspace: ReturnType<AppDatabase["core"]["workspaces"]["getWorkspace"]>;
    workspaceMode: "exclusive" | "shared" | "none";
    companyName: string;
    companyDescription: string;
    snapshot: ReturnType<AppDatabase["projection"]["snapshot"]["listSnapshot"]>;
    trigger: string;
  }) => void;
  processRunCompletion: (run: RunRecord, event: z.infer<typeof workerMessageSchema> & { type: "run-finished" }) => void;
  onRunStarted?: (runId: string, taskId: string | null, agentId: string, companyId: string) => void;
  onRunCompleted?: (runId: string, taskId: string | null, agentId: string, companyId: string, status: string, summary: string | null, errorMessage: string | null) => void;
  notify: (options: NotificationOptions) => void;
  budgetService?: ReturnType<typeof createBudgetEnforcementService>;
  sessionService?: ReturnType<typeof createSessionManagementService>;
  /** Forwards `agent-event` from worker to renderer and routes RPC to main services. */
  getRuntimeBridge?: () => RuntimeBridge | null;
  /**
   * Resolves the shared runtime message injector so `steer-ack` child
   * messages can commit inbox delivery or trigger a wake fallback.
   */
  getRuntimeMessageInjector?: () => RuntimeMessageInjector | null;
}
