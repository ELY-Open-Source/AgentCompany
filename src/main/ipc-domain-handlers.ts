import type { RegisterDomainHandlersDependencies } from "./ipc-domain-common";
import { registerAgentCoordinationHandlers } from "./ipc-agent-coordination-handlers";
import { registerAutomationOperationsHandlers } from "./ipc-automation-operations-handlers";
import { registerBrowserHandlers } from "./ipc-browser-handlers";
import { registerContentOperationsHandlers } from "./ipc-content-operations-handlers";
import { registerOnboardingHandlers } from "./ipc-onboarding-handlers";
import { registerRecoveryHandlers } from "./ipc-recovery-handlers";

export function registerDomainHandlers(dependencies: RegisterDomainHandlersDependencies) {
  registerOnboardingHandlers(dependencies);
  registerBrowserHandlers(dependencies);
  registerContentOperationsHandlers(dependencies);
  registerAutomationOperationsHandlers(dependencies);
  registerAgentCoordinationHandlers(dependencies);
  registerRecoveryHandlers(dependencies);
}
