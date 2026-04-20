import { z } from "zod";
import {
  IPC_CHANNELS,
  automationRuleInputSchema,
  deleteEntitySchema,
  runWorkflowSchema,
  toggleAutomationRuleSchema,
  workflowInputSchema,
} from "@shared/contracts";
import { fail, ok, type RegisterDomainHandlersDependencies } from "./ipc-domain-common";

export function registerAutomationOperationsHandlers({
  registerHandle,
  db,
  ensureCompanyExists,
  publishDomainChanged,
  runWorkflowPipeline,
}: Pick<
  RegisterDomainHandlersDependencies,
  | "registerHandle"
  | "db"
  | "ensureCompanyExists"
  | "publishDomainChanged"
  | "runWorkflowPipeline"
>) {
  const companyIdSchema = z.string().uuid();

  registerHandle(IPC_CHANNELS.saveAutomationRule, async (_event, payload) => {
    const parsed = automationRuleInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const id = db.automationMod.saveAutomationRule(parsed);
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.deleteAutomationRule, async (_event, payload) => {
    const parsed = deleteEntitySchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.settings.belongsToCompany("automation_rules", parsed.id, parsed.companyId)) {
      return fail("ENTITY_NOT_FOUND", "Automation rule not found in the current company.");
    }
    db.automationMod.deleteAutomationRule(parsed.id, parsed.companyId);
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.toggleAutomationRule, async (_event, payload) => {
    const parsed = toggleAutomationRuleSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.settings.belongsToCompany("automation_rules", parsed.id, parsed.companyId)) {
      return fail("ENTITY_NOT_FOUND", "Automation rule not found in the current company.");
    }
    db.automationMod.toggleAutomationRule(parsed.id, parsed.companyId, parsed.status);
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.getAutomationLog, async (_event, companyId) => {
    const parsed = companyIdSchema.parse(companyId);
    const companyError = ensureCompanyExists(parsed);
    if (companyError) return companyError;
    return ok(db.automationMod.getAutomationLog(parsed));
  });

  registerHandle(IPC_CHANNELS.saveWorkflow, async (_event, payload) => {
    const parsed = workflowInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const id = db.automationMod.saveWorkflow(parsed);
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.deleteWorkflow, async (_event, payload) => {
    const parsed = deleteEntitySchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.settings.belongsToCompany("workflow_pipelines", parsed.id, parsed.companyId)) {
      return fail("ENTITY_NOT_FOUND", "Workflow not found in the current company.");
    }
    db.automationMod.deleteWorkflow(parsed.id, parsed.companyId);
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.runWorkflow, async (_event, payload) => {
    const parsed = runWorkflowSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.settings.belongsToCompany("workflow_pipelines", parsed.id, parsed.companyId)) {
      return fail("ENTITY_NOT_FOUND", "Workflow not found in the current company.");
    }
    await runWorkflowPipeline(parsed.id, parsed.companyId);
    publishDomainChanged();
    return ok(true);
  });
}
