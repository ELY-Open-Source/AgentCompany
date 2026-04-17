import type { z } from "zod";
import type { BrowserActionRecord } from "../../types";
import type { automationRuleInputSchema, toggleAutomationRuleSchema } from "../schemas-automation";
import type { browserActionQuerySchema, cancelBrowserActionSchema, openTerminalCommandSchema, runWorkflowSchema, triggerBrowserLoginSchema, workflowInputSchema } from "../schemas-execution";
import type { socialAccountInputSchema } from "../schemas-company";
import type { deleteEntitySchema } from "../schemas-badges";
import type { wakeupQuerySchema, WakeupRequestRecord } from "../schemas-wakeup";
import type { DesktopResult } from "./common";

export type AutomationApi = {
  saveAutomationRule: (input: z.infer<typeof automationRuleInputSchema>) => Promise<DesktopResult<string>>;
  deleteAutomationRule: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  toggleAutomationRule: (input: z.infer<typeof toggleAutomationRuleSchema>) => Promise<DesktopResult<boolean>>;
  getAutomationLog: (companyId: string) => Promise<DesktopResult<Array<{ ruleId: string; ruleName: string; trigger: string; action: string; executedAt: string }>>>;
  saveWorkflow: (input: z.infer<typeof workflowInputSchema>) => Promise<DesktopResult<string>>;
  deleteWorkflow: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  runWorkflow: (input: z.infer<typeof runWorkflowSchema>) => Promise<DesktopResult<boolean>>;
  listWakeupRequests: (input: z.infer<typeof wakeupQuerySchema>) => Promise<DesktopResult<WakeupRequestRecord[]>>;
  saveSocialAccount: (input: z.infer<typeof socialAccountInputSchema>) => Promise<DesktopResult<string>>;
  deleteSocialAccount: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  listBrowserActions: (input: z.infer<typeof browserActionQuerySchema>) => Promise<DesktopResult<BrowserActionRecord[]>>;
  cancelBrowserAction: (input: z.infer<typeof cancelBrowserActionSchema>) => Promise<DesktopResult<boolean>>;
  triggerBrowserLogin: (input: z.infer<typeof triggerBrowserLoginSchema>) => Promise<DesktopResult<boolean>>;
  openTerminalCommand: (input: z.infer<typeof openTerminalCommandSchema>) => Promise<DesktopResult<boolean>>;
};
