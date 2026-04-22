import type { RegisterDomainHandlersDependencies } from "../ipc-domain-common";

export type CompanyOperationHandlerDependencies = Pick<
  RegisterDomainHandlersDependencies,
  | "registerHandle"
  | "db"
  | "ensureCompanyExists"
  | "findInvalidReference"
  | "publishDomainChanged"
  | "dispatchAutomation"
  | "threadIntegration"
  | "checkpointEngine"
  | "lifecycleProcessor"
  | "logger"
>;
