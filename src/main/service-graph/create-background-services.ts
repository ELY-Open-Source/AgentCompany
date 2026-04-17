import type { AppDatabase } from "../database";
import { BrowserManager } from "../browser-manager";
import type { DesktopEvent } from "@shared/types";
import { createAutomationService } from "../automation-service";
import { createBrowserActionService } from "../browser-action-service";
import { createOnboardingService } from "../onboarding-service";
import { createUpdaterService } from "../updater-service";
import type { createOrchestrationService } from "../orchestration-service";
import type { createSkillService } from "../skill-service";
import type { NotificationOptions } from "../notification-service";

export interface BackgroundServicesDeps {
  db: AppDatabase;
  logger: {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  emitEvent: (event: DesktopEvent) => void;
  publishDomainChanged: () => void;
  notify: (options: NotificationOptions) => void;
  isQuittingRef: { current: boolean };
  browserManagerRef: { current: BrowserManager | null };
  skillService: ReturnType<typeof createSkillService>;
  orchestrationService: ReturnType<typeof createOrchestrationService>;
  seedDefaultAutomationRules: (companyId: string) => void;
}

export interface BackgroundServices {
  automationService: ReturnType<typeof createAutomationService>;
  browserActionService: ReturnType<typeof createBrowserActionService>;
  onboardingService: ReturnType<typeof createOnboardingService>;
  updaterService: ReturnType<typeof createUpdaterService>;
}

/**
 * Build background services that run off the main dispatch loop: automation
 * triggers, browser-action dispatch, onboarding hire flow, and the updater.
 * Orchestration is fully assembled at this point, so all dependencies are
 * concrete references rather than lazy slots.
 */
export function createBackgroundServices({
  db,
  logger,
  emitEvent,
  publishDomainChanged,
  notify,
  isQuittingRef,
  browserManagerRef,
  skillService,
  orchestrationService,
  seedDefaultAutomationRules,
}: BackgroundServicesDeps): BackgroundServices {
  const browserActionService = createBrowserActionService({
    db,
    browserManagerRef,
    publishDomainChanged,
  });
  browserActionService.resetBrowserManager();

  const dispatchBrowserAction = async (actionId: string, companyId: string) =>
    browserActionService.dispatchBrowserAction(actionId, companyId);

  const automationService = createAutomationService({
    db,
    logger,
    emitEvent,
    publishDomainChanged,
    notify,
    wakeAgentIfPossible: (agentId, companyId, trigger) =>
      orchestrationService.wakeAgentIfPossible(agentId, companyId, trigger),
    dispatchBrowserAction,
    isQuitting: () => isQuittingRef.current,
  });

  const onboardingService = createOnboardingService({
    db,
    seedDefaultAutomationRules,
    queueTaskRun: (taskId, trigger, actor) =>
      orchestrationService.queueTaskRun(taskId, trigger, actor),
    publishDomainChanged,
    scanAndAssignSkills: async (companyId: string, _agentId: string) => {
      // All company skills are visible to every agent via progressive disclosure.
      // Seed the builtin catalog + any workspace-local SKILL.md bundles.
      await skillService.seedBuiltinSkills(companyId);
      await skillService.scanWorkspaceSkills(companyId);
    },
  });

  const updaterService = createUpdaterService({ db, logger, notify });
  updaterService.attachListeners();

  return { automationService, browserActionService, onboardingService, updaterService };
}
