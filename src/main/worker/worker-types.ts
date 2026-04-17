import { z } from "zod";
import type { AppDatabase } from "../database";
import type { DesktopEvent, RunRecord } from "@shared/types";
import type { NotificationOptions } from "../notification-service";
import type { createBudgetEnforcementService } from "../budget-enforcement-service";
import type { createSessionManagementService } from "../session-management-service";
import type { RuntimeBridge } from "../agent-runtime";

const runStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "cancelled", "timed_out", "interrupted"]);

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
    sessionParams: z.record(z.string(), z.unknown()).nullable(),
    sessionDisplayId: z.string().nullable(),
    unattributedCost: z.boolean(),
    inputTokens: z.number().nullable(),
    outputTokens: z.number().nullable(),
  }),
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
    type: z.literal("rpc-request"),
    rpcId: z.string(),
    runId: z.string().uuid(),
    method: z.enum(["persistMessage", "prepareRun", "beforeToolCall"]),
    payload: z.unknown(),
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
    agent: ReturnType<AppDatabase["getAgent"]>;
    task: ReturnType<AppDatabase["getTask"]> | null;
    connector: ReturnType<AppDatabase["getConnector"]>;
    workspace: ReturnType<AppDatabase["getWorkspace"]>;
    workspaceMode: "exclusive" | "shared" | "none";
    companyName: string;
    companyDescription: string;
    snapshot: ReturnType<AppDatabase["listSnapshot"]>;
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
}
