import type { z } from "zod";
import type { WorkerServiceDependencies, workerMessageSchema } from "../entry/types";

export type WorkerMessageEvent = z.infer<typeof workerMessageSchema>;

export type HandlerDeps = Pick<
  WorkerServiceDependencies,
  | "db"
  | "logger"
  | "isQuitting"
  | "emitEvent"
  | "wakeAgentIfPossible"
  | "processRunCompletion"
  | "onRunStarted"
  | "onRunCompleted"
  | "notify"
  | "budgetService"
  | "sessionService"
>;

export interface HandlerContext {
  destroyed: boolean;
  MAX_RETRY_ATTEMPTS: number;
  RETRY_COOLDOWN_MS: number;
  MAX_CONSECUTIVE_SELF_WAKES: number;
  selfWakeAttemptMap: Map<string, number>;
  pendingRetryTimers: Set<ReturnType<typeof setTimeout>>;
  leaseRenewalMap: Map<string, number>;
}
