import type { RegisterCoreHandlersDependencies } from "./ipc-core-common";
import { registerCoreAdminHandlers } from "./ipc-core-admin-handlers";
import { registerCoreOperationHandlers } from "./ipc-core-operations-handlers";
import { registerCoreReadHandlers } from "./ipc-core-read-handlers";
import { registerCoreWorkGraphHandlers } from "./ipc-core-work-graph-handlers";

export function registerCoreHandlers(dependencies: RegisterCoreHandlersDependencies) {
  registerCoreReadHandlers(dependencies);
  registerCoreAdminHandlers(dependencies);
  registerCoreWorkGraphHandlers(dependencies);
  registerCoreOperationHandlers(dependencies);
}
