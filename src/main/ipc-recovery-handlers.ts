import { IPC_CHANNELS, recoveryRetrySchema, recoveryTaskSchema } from "@shared/contracts";
import { fail, ok, type RegisterDomainHandlersDependencies } from "./ipc-domain-common";

export function registerRecoveryHandlers({
  registerHandle,
  db,
  ensureCompanyExists,
  publishDomainChanged,
  wakeAgentIfPossible,
  logger,
}: Pick<
  RegisterDomainHandlersDependencies,
  | "registerHandle"
  | "db"
  | "ensureCompanyExists"
  | "publishDomainChanged"
  | "wakeAgentIfPossible"
  | "logger"
>) {
  registerHandle(IPC_CHANNELS.recoveryRetry, async (_event, payload) => {
    const parsed = recoveryRetrySchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.core.settings.belongsToCompany("tasks", parsed.taskId, parsed.companyId)) {
      return fail("TASK_NOT_FOUND", "Task not found in the current company.");
    }
    db.core.tasks.retryInterruptedTask(parsed.taskId, parsed.agentId, parsed.companyId);
    try {
      wakeAgentIfPossible(parsed.agentId, parsed.companyId, "retry_interrupted");
    } catch (err) {
      logger.warn(`[ipc/recovery] wakeAgentIfPossible failed for agent ${parsed.agentId}:`, err instanceof Error ? err.message : String(err));
    }
    publishDomainChanged();
    return ok(null);
  });

  registerHandle(IPC_CHANNELS.recoveryFail, async (_event, payload) => {
    const parsed = recoveryTaskSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.core.settings.belongsToCompany("tasks", parsed.taskId, parsed.companyId)) {
      return fail("TASK_NOT_FOUND", "Task not found in the current company.");
    }
    db.core.tasks.markInterruptedTaskFailed(parsed.taskId);
    publishDomainChanged();
    return ok(null);
  });
}
