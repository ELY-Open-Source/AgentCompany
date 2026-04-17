import type { RegisterCoreHandlersDependencies } from "./ipc-core-common";
import { registerCoreAgentGraphHandlers } from "./ipc-core-agent-graph-handlers";
import { registerCoreTaskGraphHandlers } from "./ipc-core-task-graph-handlers";

export function registerCoreWorkGraphHandlers(
  deps: Pick<
    RegisterCoreHandlersDependencies,
    | "registerHandle"
    | "db"
    | "ensureCompanyExists"
    | "findInvalidReference"
    | "publishDomainChanged"
    | "emitEvent"
    | "wakeAgentIfPossible"
    | "handleApprovalResolved"
    | "handleTaskCreated"
    | "handleTaskStatusChange"
    | "logger"
  >,
) {
  registerCoreAgentGraphHandlers({
    registerHandle: deps.registerHandle,
    db: deps.db,
    ensureCompanyExists: deps.ensureCompanyExists,
    findInvalidReference: deps.findInvalidReference,
    publishDomainChanged: deps.publishDomainChanged,
    handleApprovalResolved: deps.handleApprovalResolved,
    logger: deps.logger,
  });
  registerCoreTaskGraphHandlers({
    registerHandle: deps.registerHandle,
    db: deps.db,
    ensureCompanyExists: deps.ensureCompanyExists,
    findInvalidReference: deps.findInvalidReference,
    publishDomainChanged: deps.publishDomainChanged,
    emitEvent: deps.emitEvent,
    wakeAgentIfPossible: deps.wakeAgentIfPossible,
    handleTaskCreated: deps.handleTaskCreated,
    handleTaskStatusChange: deps.handleTaskStatusChange,
    logger: deps.logger,
  });
}
