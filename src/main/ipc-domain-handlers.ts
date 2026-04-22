import type { RegisterDomainHandlersDependencies } from "./ipc-domain-common";
import { registerAgentCoordinationHandlers } from "./ipc-agent-coordination-handlers";
import { registerAutomationOperationsHandlers } from "./ipc-automation-operations-handlers";
import { registerBrowserHandlers } from "./ipc-browser-handlers";
import { registerCompanyOperationsHandlers } from "./ipc-company-operations/index";
import { registerOnboardingHandlers } from "./ipc-onboarding-handlers";
import { registerRecoveryHandlers } from "./ipc-recovery-handlers";
import { registerSkillHandlers } from "./ipc-skill-handlers";
import { registerBudgetHandlers } from "./ipc-budget-handlers";

export function registerDomainHandlers(dependencies: RegisterDomainHandlersDependencies) {
  registerOnboardingHandlers(dependencies);
  registerBrowserHandlers(dependencies);
  registerCompanyOperationsHandlers(dependencies);
  registerAutomationOperationsHandlers(dependencies);
  registerAgentCoordinationHandlers(dependencies);
  registerRecoveryHandlers(dependencies);
  registerSkillHandlers({
    registerHandle: dependencies.registerHandle,
    ensureCompanyExists: dependencies.ensureCompanyExists,
    publishDomainChanged: dependencies.publishDomainChanged,
    skillService: dependencies.skillService,
    db: dependencies.db,
    logger: dependencies.logger,
  });
  registerBudgetHandlers({
    registerHandle: dependencies.registerHandle,
    ensureCompanyExists: dependencies.ensureCompanyExists,
    publishDomainChanged: dependencies.publishDomainChanged,
    budgetService: dependencies.budgetService,
    db: dependencies.db,
    logger: dependencies.logger,
  });
}
