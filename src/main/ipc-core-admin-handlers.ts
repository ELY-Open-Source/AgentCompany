import { execFile } from "node:child_process";
import {
  IPC_CHANNELS,
  companyInputSchema,
  connectorDisabledModelsSchema,
  connectorInputSchema,
  deleteEntitySchema,
  openTerminalCommandSchema,
} from "@shared/contracts";
import { validateConnectorConfigurationModel, validateConnectorModelSelection } from "./connector-model-policy";
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
    const previousMode = parsed.id ? db.getCompanyExecutionMode(parsed.id) : parsed.executionMode;
    const previousApprovalSettings = parsed.id
      ? db.getCompanyApprovalSettings(parsed.id)
      : { autoApproveHires: parsed.autoApproveHires, reviewDeliverables: parsed.reviewDeliverables };
    const id = db.saveCompany(parsed);
    reconcileExecutionModeChange({
      db,
      companyId: id,
      previousExecutionMode: previousMode,
      nextExecutionMode: parsed.executionMode,
      previousReviewDeliverables: previousApprovalSettings?.reviewDeliverables ?? false,
      nextReviewDeliverables: parsed.reviewDeliverables,
      handleApprovalResolved,
    });
    db.addActivity({
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
    if (typeof companyId !== "string" || !companyId) {
      return fail("INVALID_COMPANY_ID", "A valid company id is required.");
    }
    if (!db.hasCompany(companyId)) {
      return fail("COMPANY_NOT_FOUND", "The selected company does not exist.");
    }
    db.setCurrentCompany(companyId);
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.saveConnector, async (_event, payload) => {
    const parsed = connectorInputSchema.parse(payload);
    const existingConnector = db.getConnector(parsed.id);
    if (parsed.command !== existingConnector.command) {
      return fail("CONNECTOR_COMMAND_LOCKED", `Connector command is managed by AgentCompany and must remain "${existingConnector.command}".`);
    }
    const connectorConfigValidation = validateConnectorConfigurationModel(parsed.id, parsed.model ?? null);
    if (!connectorConfigValidation.ok) {
      return fail("CONNECTOR_MODEL_NOT_ALLOWED", connectorConfigValidation.error);
    }
    const modelSelection = validateConnectorModelSelection(db, parsed.id, parsed.model ?? null);
    if (!modelSelection.ok) {
      return fail("CONNECTOR_MODEL_NOT_ALLOWED", modelSelection.error);
    }
    db.saveConnector({
      ...parsed,
      command: existingConnector.command,
      model: parsed.model ?? null,
    });
    db.addActivity({
      companyId: db.getCurrentCompanyId() ?? "00000000-0000-0000-0000-000000000000",
      actor: "board",
      action: "connector.updated",
      entityType: "connector",
      entityId: parsed.id,
      detail: existingConnector.command,
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
    db.setDisabledModels(parsed.connectorId, parsed.disabledModels);
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.deleteSecret, async (_event, payload) => {
    const parsed = deleteEntitySchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    if (!db.belongsToCompany("secrets", parsed.id, parsed.companyId)) {
      return fail("SECRET_NOT_FOUND", "Secret not found in the current company.");
    }
    db.deleteSecret(parsed.id, parsed.companyId);
    db.addActivity({
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
    if (typeof companyId !== "string" || companyId.length === 0) {
      return fail("INVALID_INPUT", "Company ID is required.");
    }
    if (!db.hasCompany(companyId)) {
      return fail("COMPANY_NOT_FOUND", "Company not found.");
    }
    db.deleteCompany(companyId);
    publishDomainChanged();
    return ok(true);
  });
}
