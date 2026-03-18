import {
  IPC_CHANNELS,
  companyInputSchema,
  connectorInputSchema,
  deleteEntitySchema,
  secretInputSchema,
} from "@shared/contracts";
import { fail, ok, type RegisterCoreHandlersDependencies } from "./ipc-core-common";

export function registerCoreAdminHandlers({
  registerHandle,
  db,
  ensureCompanyExists,
  publishDomainChanged,
  checkConnector,
  openConnectorAuthTerminal,
}: Pick<
  RegisterCoreHandlersDependencies,
  "registerHandle" | "db" | "ensureCompanyExists" | "publishDomainChanged" | "checkConnector" | "openConnectorAuthTerminal"
>) {
  registerHandle(IPC_CHANNELS.saveCompany, async (_event, payload) => {
    const parsed = companyInputSchema.parse(payload);
    const id = db.saveCompany(parsed);
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

  registerHandle(IPC_CHANNELS.openConnectorAuthTerminal, async (_event, id) => {
    const parsed = connectorInputSchema.shape.id.parse(id);
    await openConnectorAuthTerminal(parsed);
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.saveSecret, async (_event, payload) => {
    const parsed = secretInputSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    const id = db.saveSecret(parsed);
    db.addActivity({
      companyId: parsed.companyId,
      actor: "board",
      action: parsed.id ? "secret.updated" : "secret.created",
      entityType: "secret",
      entityId: id,
      detail: parsed.name,
    });
    publishDomainChanged();
    return ok(id);
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
