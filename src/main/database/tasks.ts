import type { DatabaseSync } from "node:sqlite";
import type { ReadAll, Transaction } from "./helpers";
import { buildTaskCrudMethods } from "./tasks-crud";
import { buildTaskQueryMethods } from "./task-queries";
import { buildTaskSessionMethods } from "./task-sessions-crud";
import { buildTaskStatusMethods } from "./tasks-status";
import { buildTasksPhaseMethods } from "./tasks-phase";
import { buildTaskUpdateMethods } from "./tasks-update";

export function buildTaskMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
  deps: {
    addComment: (input: { companyId: string; taskId: string; authorAgentId: string | null; authorName: string; body: string }) => void;
    addActivity: (input: { companyId: string; actor: string; action: string; entityType: string; entityId: string; detail: string }) => void;
    requestApproval: (input: {
      companyId: string;
      relatedTaskId?: string | null;
      requestedByAgentId?: string | null;
      relatedAgentId?: string | null;
      type: string;
      payloadSummary: string;
      impactSummary: string;
      payloadJson?: string | null;
    }) => string;
    setHeartbeat: (agentId: string, enabled: boolean, intervalSec: number) => void;
  },
) {
  return {
    ...buildTaskCrudMethods(getDb, readAll, transaction, deps),
    ...buildTaskQueryMethods(getDb, readAll, transaction),
    ...buildTaskSessionMethods(getDb, readAll, transaction),
    ...buildTaskStatusMethods(getDb, readAll, transaction, deps),
    ...buildTaskUpdateMethods(getDb, readAll, transaction, deps),
    ...buildTasksPhaseMethods(getDb),
  };
}
