import { dialog, nativeTheme, shell } from "electron";
import { join } from "node:path";
import { z } from "zod";
import {
  IPC_CHANNELS,
  connectorInputSchema,
  connectorModelPoolQuerySchema,
  entityGetterSchema,
  metricsQuerySchema,
  settingsSchema,
} from "@shared/contracts";
import { fail, ok, type RegisterCoreHandlersDependencies } from "./ipc-core-common";
import { logAppError } from "./errors/index.js";

export function registerCoreReadHandlers({
  registerHandle,
  db,
  ensureCompanyExists,
  publishDomainChanged,
  checkForUpdates,
  resetAfterRestore,
  listConnectorModels,
  logger,
}: Pick<
  RegisterCoreHandlersDependencies,
  | "registerHandle"
  | "db"
  | "ensureCompanyExists"
  | "publishDomainChanged"
  | "checkForUpdates"
  | "resetAfterRestore"
  | "listConnectorModels"
  | "logger"
>) {
  registerHandle(IPC_CHANNELS.loadSnapshot, () => ok(db.projection.snapshot.listRendererSnapshot()));

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
    if (!db.core.settings.canOpenPath(targetPath)) {
      return fail("OPEN_PATH_FORBIDDEN", "The requested path is outside the managed desktop workspace.");
    }
    const error = await shell.openPath(targetPath);
    return error ? fail("OPEN_PATH_FAILED", error) : ok(true);
  });

  /**
   * openWorkProduct resolves a work_product row to a concrete absolute
   * path (or URL) before handing off to the OS shell. The DocumentCenter
   * can no longer forward `externalId` straight into `openPath`: that
   * column stores a workspace-relative path so artifacts survive a
   * workspace-root move, but `shell.openPath` wants an absolute managed
   * path. The DB resolver joins the work_product back to its originating
   * task → workspace (or run → workspace for taskless runs) so the path
   * we hand to the shell is always inside the currently-mounted managed
   * tree and passes `canOpenPath` validation.
   */
  registerHandle(IPC_CHANNELS.openWorkProduct, async (_event, payload) => {
    const parsed = entityGetterSchema.safeParse(payload);
    if (!parsed.success) return fail("INVALID_PAYLOAD", "openWorkProduct requires { companyId, id }.");
    const companyError = ensureCompanyExists(parsed.data.companyId);
    if (companyError) return companyError;
    const target = db.core.documents.resolveWorkProductTarget(parsed.data.id, parsed.data.companyId);
    if (target.kind === "error") {
      const codeByReason = {
        not_found: "WORK_PRODUCT_NOT_FOUND",
        archived: "WORK_PRODUCT_ARCHIVED",
        no_target: "WORK_PRODUCT_NO_TARGET",
        workspace_unresolved: "WORK_PRODUCT_WORKSPACE_UNRESOLVED",
        path_escape: "WORK_PRODUCT_PATH_ESCAPE",
        path_missing: "WORK_PRODUCT_PATH_MISSING",
      } as const;
      if (target.reason === "path_missing") {
        db.core.documents.updateWorkProduct(parsed.data.id, parsed.data.companyId, { status: "archived" });
        publishDomainChanged();
      }
      return fail(codeByReason[target.reason], target.detail);
    }
    if (target.kind === "url") {
      const error = await shell.openExternal(target.value).then(() => "").catch((err: unknown) => err instanceof Error ? err.message : String(err));
      return error ? fail("OPEN_PATH_FAILED", error) : ok(true);
    }
    if (!db.core.settings.canOpenPath(target.value)) {
      return fail("OPEN_PATH_FORBIDDEN", "The requested path is outside the managed desktop workspace.");
    }
    const error = await shell.openPath(target.value);
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
    await db.core.backup.exportBackup(backupPath);
    return ok(backupPath);
  });

  registerHandle(IPC_CHANNELS.restoreProfile, async () => {
    const hasActiveRuns = db.projection.snapshot.listSnapshot().runs.some((run: { status: string }) => run.status === "queued" || run.status === "running");
    if (hasActiveRuns) {
      return fail("RESTORE_BLOCKED", "Stop all active runs before restoring a profile backup.");
    }
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return ok(false);
    }
    await db.core.backup.restoreFromBackup(result.filePaths[0]!);
    resetAfterRestore();
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.updateSettings, async (_event, payload) => {
    const parsed = settingsSchema.parse(payload);
    db.core.settings.updateSettings(parsed);
    if (parsed.theme) {
      nativeTheme.themeSource = parsed.theme;
    }
    publishDomainChanged();
    return ok(true);
  });

  registerHandle(IPC_CHANNELS.checkForUpdates, async () => {
    // Invocation via IPC only happens when the user opens Settings and clicks
    // "Check for updates". Pass manual:true so the Up-to-Date toast fires.
    return ok(await checkForUpdates({ manual: true }));
  });

  registerHandle(IPC_CHANNELS.listConnectorModels, async (_event, connectorId) => {
    try {
      const parsed = connectorInputSchema.shape.id.parse(connectorId);
      return ok(await listConnectorModels(parsed));
    } catch (err) {
      logAppError(logger, err, {
        kind: "upstream",
        code: "ipc.list_connector_models.failed",
        message: `listConnectorModels failed for connector ${String(connectorId)}`,
        context: { connectorId },
      }, "warn");
      return ok([]);
    }
  });

  registerHandle(IPC_CHANNELS.getConnectorDisabledModels, (_event, payload) => {
    try {
      const parsed = connectorModelPoolQuerySchema.parse(payload);
      return ok(db.core.settings.getDisabledModels(parsed.companyId, parsed.connectorId));
    } catch (err) {
      logAppError(logger, err, {
        kind: "user_input",
        code: "ipc.get_connector_disabled_models.invalid_payload",
        message: "getConnectorDisabledModels rejected payload (schema parse failed)",
      }, "warn");
      return ok([]);
    }
  });

  registerHandle(IPC_CHANNELS.getCompanyMetrics, (_event, payload) => {
    const input = metricsQuerySchema.parse(payload);
    const err = ensureCompanyExists(input.companyId);
    if (err) return err;
    return ok(db.core.company.getCompanyMetrics(input.companyId, input.days));
  });

  registerHandle(IPC_CHANNELS.getStandupReport, (_event, payload) => {
    const companyId = z.string().uuid().parse(payload);
    const err = ensureCompanyExists(companyId);
    if (err) return err;
    return ok(db.core.company.getStandupReport(companyId));
  });

  // --- Entity getters for granular IPC updates ---

  registerHandle(IPC_CHANNELS.getTask, (_event, payload) => {
    const parsed = entityGetterSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    try {
      const task = db.core.entity.getTask(parsed.id);
      if (task.companyId !== parsed.companyId) return fail("TASK_NOT_FOUND", "Task not found in current company.");
      return ok(task);
    } catch (err) {
      logAppError(logger, err, {
        kind: "recoverable",
        code: "ipc.get_task.lookup_failed",
        message: `getTask failed for id ${parsed.id}`,
        context: { taskId: parsed.id, companyId: parsed.companyId },
      }, "warn");
      return fail("TASK_NOT_FOUND", "Task not found.");
    }
  });

  registerHandle(IPC_CHANNELS.getAgent, (_event, payload) => {
    const parsed = entityGetterSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    try {
      const agent = db.core.entity.getAgent(parsed.id);
      if (agent.companyId !== parsed.companyId) return fail("AGENT_NOT_FOUND", "Agent not found in current company.");
      return ok(agent);
    } catch (err) {
      logAppError(logger, err, {
        kind: "recoverable",
        code: "ipc.get_agent.lookup_failed",
        message: `getAgent failed for id ${parsed.id}`,
        context: { agentId: parsed.id, companyId: parsed.companyId },
      }, "warn");
      return fail("AGENT_NOT_FOUND", "Agent not found.");
    }
  });

  registerHandle(IPC_CHANNELS.getRun, (_event, payload) => {
    const parsed = entityGetterSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    try {
      const run = db.core.runs.getRun(parsed.id);
      if (run.companyId !== parsed.companyId) return fail("RUN_NOT_FOUND", "Run not found in current company.");
      return ok(run);
    } catch (err) {
      logAppError(logger, err, {
        kind: "recoverable",
        code: "ipc.get_run.lookup_failed",
        message: `getRun failed for id ${parsed.id}`,
        context: { runId: parsed.id, companyId: parsed.companyId },
      }, "warn");
      return fail("RUN_NOT_FOUND", "Run not found.");
    }
  });

  registerHandle(IPC_CHANNELS.getApproval, (_event, payload) => {
    const parsed = entityGetterSchema.parse(payload);
    const companyError = ensureCompanyExists(parsed.companyId);
    if (companyError) return companyError;
    try {
      const approval = db.core.approvals.getApprovalRecord(parsed.id);
      if (approval.companyId !== parsed.companyId) return fail("APPROVAL_NOT_FOUND", "Approval not found in current company.");
      return ok(approval);
    } catch (err) {
      logAppError(logger, err, {
        kind: "recoverable",
        code: "ipc.get_approval.lookup_failed",
        message: `getApprovalRecord failed for id ${parsed.id}`,
        context: { approvalId: parsed.id, companyId: parsed.companyId },
      }, "warn");
      return fail("APPROVAL_NOT_FOUND", "Approval not found.");
    }
  });
}
