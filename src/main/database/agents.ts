import type { DatabaseSync } from "node:sqlite";
import type { AgentRecord } from "@shared/types";
import type { ReadAll, Transaction } from "./helpers";
import { buildAgentCrudMethods } from "./agents-crud";
import { buildAgentHierarchyMethods } from "./agents-hierarchy";
import { buildAgentPermissionMethods } from "./agent-permissions";

export function buildAgentMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
  deps: {
    getAgent: (id: string) => AgentRecord;
    wouldCreateAgentCycle: (agentId: string, reportsTo: string | null) => boolean;
    recordConfigRevision: (input: {
      companyId: string;
      agentId: string;
      changedKeys: string[];
      configBefore: Record<string, unknown>;
      configAfter: Record<string, unknown>;
      source?: string;
      rolledBackFromRevisionId?: string | null;
      createdByAgentId?: string | null;
      createdByUserId?: string | null;
    }) => string;
    cancelRunForDeletion: (runId: string, taskId: string | null, workspaceId: string | null, summary: string) => void;
    addActivity: (input: { companyId: string; actor: string; action: string; entityType: string; entityId: string; detail: string }) => void;
  },
) {
  return {
    ...buildAgentCrudMethods(getDb, readAll, transaction, deps),
    ...buildAgentHierarchyMethods(getDb, readAll, transaction, { getAgent: deps.getAgent }),
    ...buildAgentPermissionMethods(getDb, readAll, transaction),
  };
}
