import { dialog, shell } from "electron";
import { join } from "node:path";
import { z } from "zod";
import {
  IPC_CHANNELS,
  connectorInputSchema,
  metricsQuerySchema,
  settingsSchema,
} from "@shared/contracts";
import { fail, ok, type RegisterCoreHandlersDependencies } from "./ipc-core-common";

export function registerCoreReadHandlers({
  registerHandle,
  db,
  ensureCompanyExists,
  publishDomainChanged,
  checkForUpdates,
  resetAfterRestore,
  getApiPort,
  listConnectorModels,
}: Pick<
  RegisterCoreHandlersDependencies,
  | "registerHandle"
  | "db"
  | "ensureCompanyExists"
  | "publishDomainChanged"
  | "checkForUpdates"
  | "resetAfterRestore"
  | "getApiPort"
  | "listConnectorModels"
>) {
  registerHandle(IPC_CHANNELS.loadSnapshot, () => ok(db.listRendererSnapshot()));

  registerHandle(IPC_CHANNELS.pickDirectory, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    return ok(result.canceled ? null : (result.filePaths[0] ?? null));
  });

  registerHandle(IPC_CHANNELS.openPath, async (_event, targetPath) => {
    if (typeof targetPath !== "string" || targetPath.length === 0) {
      return fail("INVALID_PATH", "A valid path is required.");
    }
    if (!db.canOpenPath(targetPath)) {
      return fail("OPEN_PATH_FORBIDDEN", "The requested path is outside the managed desktop workspace.");
    }
    const error = await shell.openPath(targetPath);
    return error ? fail("OPEN_PATH_FAILED", error) : ok(true);
  });

  registerHandle(IPC_CHANNELS.backupProfile, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return ok(null);
    }
    const backupPath = join(result.filePaths[0]!, `agentcompany-backup-${Date.now()}`);
    await db.exportBackup(backupPath);
    return ok(backupPath);
  });

  registerHandle(IPC_CHANNELS.restoreProfile, async () => {
    const hasActiveRuns = db.listSnapshot().runs.some((run: { status: string }) => run.status === "queued" || run.status === "running");
    if (hasActiveRuns) {
      return fail("RESTORE_BLOCKED", "Stop all active runs before restoring a profile backup.");
    }
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return ok(false);
    }
    await db.restoreFromBackup(result.filePaths[0]!);
    resetAfterRestore();
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.updateSettings, async (_event, payload) => {
    const parsed = settingsSchema.parse(payload);
    db.updateSettings(parsed);
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.checkForUpdates, async () => {
    return ok(await checkForUpdates());
  });

  registerHandle(IPC_CHANNELS.getSidebarBadges, async (_event, companyId) => {
    if (typeof companyId !== "string" || !companyId) {
      return fail("INVALID_COMPANY_ID", "A valid company id is required.");
    }
    return ok(db.getSidebarBadges(companyId));
  });

  registerHandle(IPC_CHANNELS.getApiPort, () => ok(getApiPort()));

  registerHandle(IPC_CHANNELS.listConnectorModels, async (_event, connectorId) => {
    try {
      const parsed = connectorInputSchema.shape.id.parse(connectorId);
      return ok(await listConnectorModels(parsed));
    } catch {
      return ok([]);
    }
  });

  registerHandle(IPC_CHANNELS.getInbox, (_event, payload) => {
    const companyId = z.string().uuid().parse(payload);
    const err = ensureCompanyExists(companyId);
    if (err) return err;
    return ok(db.getInbox(companyId));
  });

  registerHandle(IPC_CHANNELS.getCompanyMetrics, (_event, payload) => {
    const input = metricsQuerySchema.parse(payload);
    const err = ensureCompanyExists(input.companyId);
    if (err) return err;
    return ok(db.getCompanyMetrics(input.companyId, input.days));
  });

  registerHandle(IPC_CHANNELS.getAgentMetrics, (_event, payload) => {
    const input = metricsQuerySchema.parse(payload);
    const err = ensureCompanyExists(input.companyId);
    if (err) return err;
    if (!input.agentId) {
      return fail("MISSING_AGENT_ID", "agentId is required");
    }
    const metrics = db.getCompanyMetrics(input.companyId, input.days);
    const agentMetric = metrics.agentMetrics.find((metric: { agentId: string }) => metric.agentId === input.agentId);
    if (!agentMetric) {
      return fail("AGENT_NOT_FOUND", "Agent metrics not found");
    }
    return ok(agentMetric);
  });

  registerHandle(IPC_CHANNELS.getStandupReport, (_event, payload) => {
    const companyId = z.string().uuid().parse(payload);
    const err = ensureCompanyExists(companyId);
    if (err) return err;
    return ok(db.getStandupReport(companyId));
  });
}
