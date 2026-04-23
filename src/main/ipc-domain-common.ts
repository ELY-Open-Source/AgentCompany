import type { IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import type { DesktopResult } from "@shared/contracts";
import type { bootstrapOnboardingSchema } from "@shared/contracts";
import type { AgentMessageRecord, DesktopEvent, SectionId } from "@shared/types";
import type { AppDatabase } from "./database";
import type { createSkillService } from "./skill-service";
import type { createBudgetEnforcementService } from "./budget-enforcement-service";
import type { CheckpointEngineLike } from "./document-lifecycle";
import type { DocumentLifecycleProcessor } from "./document-lifecycle-processor";
import type { ThreadIntegrationService } from "./thread-integration";

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
  extractProfileFromSession: (socialAccountId: string, platform: string) => Promise<{
    accountName: string;
    displayName: string;
  }>;
}

export interface RegisterDomainHandlersDependencies {
  registerHandle: (
    channel: string,
    handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<DesktopResult<unknown>> | DesktopResult<unknown>,
  ) => void;
  db: AppDatabase;
  logger: {
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  ensureCompanyExists: (companyId: string) => DesktopResult<never> | null;
  findInvalidReference: (
    companyId: string,
    refs: Array<{ id: string | null | undefined; table: string; label: string }>,
  ) => { id: string | null | undefined; table: string; label: string } | null;
  publishDomainChanged: () => void;
  emitEvent: (event: DesktopEvent) => void;
  notify: (options: { title: string; body: string; urgency: "critical" | "informational"; navigation?: { section: SectionId; entityId?: string }; batchKey?: string }) => void;
  wakeAgentIfPossible: (agentId: string | null | undefined, companyId: string, trigger: string) => string | null;
  injectRuntimeMessage: (recipientAgentId: string, companyId: string, message: AgentMessageRecord) => boolean;
  dispatchAutomation: (trigger: string, ctx: { companyId: string; [key: string]: unknown }) => void;
  runWorkflowPipeline: (workflowId: string, companyId: string) => Promise<void>;
  bootstrapOnboarding: (input: z.infer<typeof bootstrapOnboardingSchema>) => unknown;
  getBrowserActions: () => BrowserActionControl | null;
  randomFallbackCompanyId: () => string;
  skillService: ReturnType<typeof createSkillService> | null;
  budgetService: ReturnType<typeof createBudgetEnforcementService> | null;
  /** Called when a human sends a message to resolve thread wait states. */
  onHumanMessage?: (companyId: string, toAgentId?: string | null, threadId?: string | null, waitStateId?: string | null) => void;
  /**
   * Shared document-creation lifecycle collaborators. Routed through the
   * dependency bag so both the IPC save path and the HTTP save path call
   * the same `createDocumentWithLifecycle` fan-out.
   */
  threadIntegration: ThreadIntegrationService;
  checkpointEngine: CheckpointEngineLike;
  lifecycleProcessor: Pick<DocumentLifecycleProcessor, "drainForDocument">;
}

export { ok, fail } from "./ipc-core-common";
