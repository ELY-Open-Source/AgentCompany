import { execFile } from "node:child_process";
import {
  IPC_CHANNELS,
  companyIdSchema,
  companyInputSchema,
  connectorDisabledModelsSchema,
  connectorInputSchema,
  deleteEntitySchema,
  openTerminalCommandSchema,
} from "@shared/contracts";
import { validateConnectorConfigurationModel } from "./connector-model-policy";
import { reconcileExecutionModeChange } from "./execution-mode-reconciler";
import { fail, ok, type RegisterCoreHandlersDependencies } from "./ipc-core-common";

/**
 * Probe the user's shell PATH for a `node` binary. The onboarding Node
 * check uses this to decide whether agents will be able to run the
 * "Node.js fetch()" snippets the API prompt-builder emits. Returns the
 * shell `node --version` output on success; never surfaces the raw
 * `process.version` (that is Electron's bundled Node, not what the
 * agent's bash tool will actually invoke).
 */
function probeShellNode(timeoutMs = 3000): Promise<{ installed: boolean; version: string | null }> {
  return new Promise((resolve) => {
    execFile("node", ["--version"], { timeout: timeoutMs }, (error, stdout) => {
      if (error) {
        resolve({ installed: false, version: null });
        return;
      }
      const version = stdout.trim();
      resolve({ installed: version.length > 0, version: version.length > 0 ? version : null });
    });
  });
}

export function registerCoreAdminHandlers({
  registerHandle,
  db,
  ensureCompanyExists,
  publishDomainChanged,
  handleApprovalResolved,
  checkConnector,
  openGenericTerminal,
}: Pick<
  RegisterCoreHandlersDependencies,
  "registerHandle" | "db" | "ensureCompanyExists" | "publishDomainChanged" | "handleApprovalResolved" | "checkConnector" | "openGenericTerminal"
>) {
  registerHandle(IPC_CHANNELS.saveCompany, async (_event, payload) => {
    const parsed = companyInputSchema.parse(payload);
    const previousMode = parsed.id ? db.core.company.getCompanyExecutionMode(parsed.id) : parsed.executionMode;
    const previousApprovalSettings = parsed.id
      ? db.core.company.getCompanyApprovalSettings(parsed.id)
      : { autoApproveHires: parsed.autoApproveHires, reviewDeliverables: parsed.reviewDeliverables };
    const id = db.core.company.saveCompany(parsed);
    reconcileExecutionModeChange({
      db,
      companyId: id,
      previousExecutionMode: previousMode,
      nextExecutionMode: parsed.executionMode,
      previousReviewDeliverables: previousApprovalSettings?.reviewDeliverables ?? false,
      nextReviewDeliverables: parsed.reviewDeliverables,
      handleApprovalResolved,
    });
    db.core.activity.addActivity({
      companyId: id,
      actor: "board",
      action: parsed.id ? "company.updated" : "company.created",
      entityType: "company",
      entityId: id,
      detail: parsed.name,
    });
    publishDomainChanged();
    return ok(id);
  });

  registerHandle(IPC_CHANNELS.setCurrentCompany, async (_event, companyId) => {
    const parsed = companyIdSchema.parse(companyId);
    if (!db.core.settings.hasCompany(parsed)) {
      return fail("COMPANY_NOT_FOUND", "The selected company does not exist.");
    }
    db.core.settings.setCurrentCompany(parsed);
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.saveConnector, async (_event, payload) => {
    const parsed = connectorInputSchema.parse(payload);
    const connectorConfigValidation = validateConnectorConfigurationModel(parsed.id, parsed.model ?? null);
    if (!connectorConfigValidation.ok) {
      return fail("CONNECTOR_MODEL_NOT_ALLOWED", connectorConfigValidation.error);
    }
    // The per-company disabled-models pool is not consulted here —
    // connector config is a global hint, and pool enforcement
    // happens at run dispatch time where the company is known.
    db.core.connectors.saveConnector({
      ...parsed,
      model: parsed.model ?? null,
    });
    db.core.activity.addActivity({
      companyId: db.core.settings.getCurrentCompanyId() ?? "00000000-0000-0000-0000-000000000000",
      actor: "board",
      action: "connector.updated",
      entityType: "connector",
      entityId: parsed.id,
      detail: parsed.id,
    });
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.testConnector, async (_event, id) => {
    const parsed = connectorInputSchema.shape.id.parse(id);
    await checkConnector(parsed);
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.checkNodeInstalled, async () => {
    return ok(await probeShellNode());
  });

  registerHandle(IPC_CHANNELS.openTerminalCommand, async (_event, payload) => {
    const parsed = openTerminalCommandSchema.parse(payload);
    await openGenericTerminal(parsed);
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.setConnectorDisabledModels, async (_event, payload) => {
    const parsed = connectorDisabledModelsSchema.parse(payload);
    db.core.settings.setDisabledModels(parsed.companyId, parsed.connectorId, parsed.disabledModels);
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.deleteSecret, async (_event, payload) => {
    const parsed = deleteEntitySchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.core.settings.belongsToCompany("secrets", parsed.id, parsed.companyId)) {
      return fail("SECRET_NOT_FOUND", "Secret not found in the current company.");
    }
    db.core.entity.deleteSecret(parsed.id, parsed.companyId);
    db.core.activity.addActivity({
      companyId: parsed.companyId,
      actor: "board",
      action: "secret.deleted",
      entityType: "secret",
      entityId: parsed.id,
      detail: "",
    });
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.deleteCompany, async (_event, companyId) => {
    const parsed = companyIdSchema.parse(companyId);
    if (!db.core.settings.hasCompany(parsed)) {
      return fail("COMPANY_NOT_FOUND", "Company not found.");
    }
    db.core.company.deleteCompany(parsed);
    publishDomainChanged();
    return ok(true);
  });
}
