import type { IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import type { DesktopResult } from "@shared/contracts";
import type { bootstrapOnboardingSchema } from "@shared/contracts";
import type { DesktopEvent } from "@shared/types";
import type { AppDatabase } from "./database";
import type { createSkillService } from "./skill-service";
import type { createBudgetEnforcementService } from "./budget-enforcement-service";

interface BrowserActionControl {
  clearSocialAccountData: (socialAccountId: string, screenshotPaths?: string[]) => Promise<void>;
  cancelAction: (actionId: string) => boolean;
  launchLoginBrowser: (socialAccountId: string, platform: string, loginUrl?: string) => Promise<{
    success: boolean;
    cancelled: boolean;
    summary: string;
    screenshotPath: string | null;
    error: string | null;
  }>;
}

export interface RegisterDomainHandlersDependencies {
  registerHandle: (
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<DesktopResult<unknown>> | DesktopResult<unknown>,
  ) => void;
  db: AppDatabase;
  logger: {
    error: (...args: unknown[]) => void;
  };
  ensureCompanyExists: (companyId: string) => DesktopResult<never> | null;
  findInvalidReference: (
    companyId: string,
    refs: Array<{ id: string | null | undefined; table: string; label: string }>,
  ) => { id: string | null | undefined; table: string; label: string } | null;
  publishDomainChanged: () => void;
  emitEvent: (event: DesktopEvent) => void;
  wakeAgentIfPossible: (agentId: string | null | undefined, companyId: string, trigger: string) => string | null;
  dispatchAutomation: (trigger: string, ctx: { companyId: string; [key: string]: unknown }) => void;
  runWorkflowPipeline: (workflowId: string, companyId: string) => Promise<void>;
  bootstrapOnboarding: (input: z.infer<typeof bootstrapOnboardingSchema>) => unknown;
  getBrowserActions: () => BrowserActionControl | null;
  randomFallbackCompanyId: () => string;
  skillService: ReturnType<typeof createSkillService> | null;
  budgetService: ReturnType<typeof createBudgetEnforcementService> | null;
}

export function ok<T>(data: T): DesktopResult<T> {
  return { ok: true, data };
}

export function fail(code: string, message: string): DesktopResult<never> {
  return { ok: false, error: { code, message } };
}
