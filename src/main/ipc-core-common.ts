import type { IpcMainInvokeEvent } from "electron";
import type { DesktopResult } from "@shared/contracts";
import type { SectionId } from "@shared/types";
import type { AppDatabase } from "./database";

export type CompanyScopedTable = "workspaces" | "agents" | "goals" | "projects" | "tasks" | "approvals" | "runs" | "secrets";

export interface RegisterCoreHandlersDependencies {
  registerHandle: (
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<DesktopResult<unknown>> | DesktopResult<unknown>,
  ) => void;
  db: AppDatabase;
  ensureCompanyExists: (companyId: string) => DesktopResult<never> | null;
  findInvalidReference: (
    companyId: string,
    refs: Array<{ id: string | null | undefined; table: CompanyScopedTable; label: string }>,
  ) => { id: string | null | undefined; table: CompanyScopedTable; label: string } | null;
  publishDomainChanged: () => void;
  emitEvent: (event: any) => void;
  wakeAgentIfPossible: (agentId: string | null | undefined, companyId: string, trigger: string) => string | null;
  handleTaskCreated: (taskId: string, companyId: string) => void;
  handleTaskStatusChange: (taskId: string, companyId: string, previousStatus: string, newStatus: string) => void;
  handleApprovalResolved: (approvalId: string, companyId: string, decision: string) => void;
  dispatchAutomation: (trigger: string, ctx: { companyId: string; [key: string]: unknown }) => void;
  queueTaskRun: (taskId: string, trigger: string, actor: string) => DesktopResult<string>;
  checkConnector: (id: any) => Promise<void>;
  openConnectorAuthTerminal: (id: any) => Promise<boolean>;
  checkForUpdates: () => Promise<boolean>;
  getWorkerProcess: () => { postMessage: (message: unknown) => void } | null;
  resetAfterRestore: () => void;
  getApiPort: () => number;
  listConnectorModels: (connectorId: string) => Promise<Array<{ id: string; label: string }>>;
  notify: (options: { title: string; body: string; urgency: "critical" | "informational"; navigation?: { section: SectionId; entityId?: string }; batchKey?: string }) => void;
}

export function ok<T>(data: T): DesktopResult<T> {
  return { ok: true, data };
}

export function fail(code: string, message: string): DesktopResult<never> {
  return { ok: false, error: { code, message } };
}
