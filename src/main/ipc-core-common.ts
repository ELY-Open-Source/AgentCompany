import type { IpcMainInvokeEvent } from "electron";
import type { DesktopResult } from "@shared/contracts";
import type { ConnectorId, DesktopEvent, SectionId } from "@shared/types";
import type { AppDatabase } from "./database";

type CompanyScopedTable = "workspaces" | "agents" | "goals" | "projects" | "tasks" | "approvals" | "runs" | "secrets";

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
  emitEvent: (event: DesktopEvent) => void;
  wakeAgentIfPossible: (agentId: string | null | undefined, companyId: string, trigger: string) => string | null;
  handleTaskCreated: (taskId: string, companyId: string) => void;
  handleTaskStatusChange: (taskId: string, companyId: string, previousStatus: string, newStatus: string) => void;
  handleApprovalCreated: (approvalId: string, companyId: string, taskId: string | null, approvalType: string, summary: string) => void;
  handleApprovalResolved: (approvalId: string, companyId: string, decision: string) => void;
  dispatchAutomation: (trigger: string, ctx: { companyId: string; [key: string]: unknown }) => void;
  queueTaskRun: (taskId: string, trigger: string, actor: string) => DesktopResult<string>;
  checkConnector: (id: ConnectorId) => Promise<void>;
  openConnectorAuthTerminal: (id: ConnectorId) => Promise<boolean>;
  openGenericTerminal: (input: { commandKey: string }) => Promise<boolean>;
  checkForUpdates: (options?: { manual?: boolean }) => Promise<boolean>;
  getWorkerProcess: () => { postMessage: (message: unknown) => void } | null;
  resetAfterRestore: () => void;
  getApiPort: () => number;
  listConnectorModels: (connectorId: string) => Promise<Array<{ id: string; label: string }>>;
  notify: (options: { title: string; body: string; urgency: "critical" | "informational"; navigation?: { section: SectionId; entityId?: string }; batchKey?: string }) => void;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

export function ok<T>(data: T): DesktopResult<T> {
  return { ok: true, data };
}

export function fail(code: string, message: string): DesktopResult<never> {
  return { ok: false, error: { code, message } };
}
