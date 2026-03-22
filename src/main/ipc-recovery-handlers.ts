import { z } from "zod";
import { ok, fail, type RegisterDomainHandlersDependencies } from "./ipc-domain-common";

const recoveryRetrySchema = z.object({
  taskId: z.string(),
  agentId: z.string(),
  companyId: z.string(),
});

const recoveryTaskSchema = z.object({
  taskId: z.string(),
});

export function registerRecoveryHandlers({
  registerHandle,
  db,
  publishDomainChanged,
  wakeAgentIfPossible,
}: Pick<
  RegisterDomainHandlersDependencies,
  | "registerHandle"
  | "db"
  | "publishDomainChanged"
  | "wakeAgentIfPossible"
>) {
  registerHandle("recovery:retry", async (_event, payload) => {
    const parsed = recoveryRetrySchema.parse(payload);
    db.retryInterruptedTask(parsed.taskId, parsed.agentId, parsed.companyId);
    try {
      wakeAgentIfPossible(parsed.agentId, parsed.companyId, "retry_interrupted");
    } catch {
      // Best effort -- agent may have been deleted
    }
    publishDomainChanged();
    return ok(null);
  });

  registerHandle("recovery:dismiss", async (_event, payload) => {
    const parsed = recoveryTaskSchema.parse(payload);
    db.dismissInterruptedTask(parsed.taskId);
    publishDomainChanged();
    return ok(null);
  });

  registerHandle("recovery:fail", async (_event, payload) => {
    const parsed = recoveryTaskSchema.parse(payload);
    db.markInterruptedTaskFailed(parsed.taskId);
    publishDomainChanged();
    return ok(null);
  });
}
