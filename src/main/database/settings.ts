import { existsSync, lstatSync, realpathSync, unlinkSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import log from "electron-log/main.js";
import type { ReadAll } from "./helpers";
import { nowIso } from "./helpers";


function isWithinOrEqual(targetPath: string, rootPath: string) {
  const resolvedTarget = resolve(targetPath);
  const resolvedRoot = resolve(rootPath);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${sep}`);
}

function safeRealpath(targetPath: string) {
  try {
    return realpathSync(targetPath);
  } catch (error) {
    log.debug(
      `[db/settings] realpathSync fallback for ${targetPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return resolve(targetPath);
  }
}

export function buildSettingsMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  deps: {
    profileDir: string;
    logsDir: string;
    artifactsDir: string;
    backupsDir: string;
  },
) {
  function getSetting(key: string): string | null {
    const row = getDb().prepare("select value from settings where key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  function setSetting(key: string, value: string) {
    getDb()
      .prepare("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value")
      .run(key, value);
  }

  return {
    getSetting,
    setSetting,

    getCurrentCompanyId() {
      return getSetting("current_company_id");
    },

    setCurrentCompany(companyId: string) {
      setSetting("current_company_id", companyId);
    },

    updateSettings(input: { theme?: "system" | "light" | "dark"; locale?: "en" | "zh"; updatesEnabled?: boolean; logRetentionDays?: number }) {
      if (input.theme) {
        setSetting("theme", input.theme);
      }
      if (input.locale) {
        setSetting("locale", input.locale);
      }
      if (typeof input.updatesEnabled === "boolean") {
        setSetting("updates_enabled", input.updatesEnabled ? "true" : "false");
      }
      if (typeof input.logRetentionDays === "number") {
        setSetting("log_retention_days", String(input.logRetentionDays));
      }
    },

    getLogRetentionDays(): number {
      const raw = getSetting("log_retention_days");
      const parsed = raw ? parseInt(raw, 10) : NaN;
      return Number.isFinite(parsed) && parsed >= 1 ? parsed : 90;
    },

    /**
     * Per-(company, connector) disabled model list.
     *
     * Pre-v42 the key-value `settings` table stored one global entry
     * per connector (`disabled_models:${connectorId}`). That let the
     * setting leak across companies — deleting a company did not
     * clear the pool config, and new companies inherited the old
     * selections. v42 moved the data to `connector_model_pool_settings`
     * with `company_id` in the primary key and `ON DELETE CASCADE`
     * from companies, so company removal wipes pool config by
     * construction.
     */
    getDisabledModels(companyId: string, connectorId: string): Array<{ id: string; label: string }> {
      const row = getDb()
        .prepare(
          "SELECT disabled_models_json AS json FROM connector_model_pool_settings WHERE company_id = ? AND connector_id = ?",
        )
        .get(companyId, connectorId) as { json: string } | undefined;
      if (!row) return [];
      try {
        return JSON.parse(row.json);
      } catch {
        return [];
      }
    },

    setDisabledModels(
      companyId: string,
      connectorId: string,
      models: Array<{ id: string; label: string }>,
    ) {
      const ts = new Date().toISOString();
      getDb()
        .prepare(
          `INSERT INTO connector_model_pool_settings (company_id, connector_id, disabled_models_json, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(company_id, connector_id) DO UPDATE SET
             disabled_models_json = excluded.disabled_models_json,
             updated_at = excluded.updated_at`,
        )
        .run(companyId, connectorId, JSON.stringify(models), ts);
    },

    hasModelPoolSettings(companyId: string, connectorId: string): boolean {
      const row = getDb()
        .prepare(
          "SELECT 1 AS found FROM connector_model_pool_settings WHERE company_id = ? AND connector_id = ? LIMIT 1",
        )
        .get(companyId, connectorId) as { found: number } | undefined;
      return !!row;
    },

    getLastBudgetResetMonth(companyId: string): string | null {
      return getSetting(`budget_reset_month_${companyId}`);
    },

    setLastBudgetResetMonth(companyId: string, month: string) {
      setSetting(`budget_reset_month_${companyId}`, month);
    },

    purgeExpiredRunLogs(): number {
      const raw = getSetting("log_retention_days");
      const parsed = raw ? parseInt(raw, 10) : NaN;
      const retentionDays = Number.isFinite(parsed) && parsed >= 1 ? parsed : 90;
      const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
      const expiredRuns = readAll<{ id: string; logPath: string | null }>(
        "select id, log_path as logPath from runs where finished_at is not null and finished_at < ? and log_path is not null",
        cutoff,
      );
      let purged = 0;
      for (const run of expiredRuns) {
        if (run.logPath) {
          try {
            unlinkSync(run.logPath);
          } catch (error) {
            log.warn(
              `[db/settings] purgeExpiredRunLogs: unlink failed for run ${run.id} (${run.logPath}): ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        getDb()
          .prepare("update runs set log_path = null, updated_at = ? where id = ?")
          .run(nowIso(), run.id);
        purged++;
      }
      return purged;
    },

    canOpenPath(targetPath: string, companyId: string) {
      if (!targetPath || !existsSync(targetPath)) {
        return false;
      }
      const managedRoots = [deps.profileDir, deps.logsDir, deps.artifactsDir, deps.backupsDir];
      const sensitiveProfileExtensions = new Set([".sqlite", ".db", ".key"]);
      const forbiddenExecutableExtensions = new Set([".app", ".exe", ".bat", ".cmd", ".sh", ".command", ".desktop", ".msi", ".com", ".scr"]);
      const resolvedTarget = safeRealpath(targetPath);
      const targetStats = lstatSync(targetPath);
      const targetExtension = extname(resolvedTarget).toLowerCase();
      if (
        managedRoots.some((rootPath) => isWithinOrEqual(resolvedTarget, rootPath)) &&
        sensitiveProfileExtensions.has(targetExtension)
      ) {
        return false;
      }
      if (!targetStats.isDirectory() && forbiddenExecutableExtensions.has(targetExtension)) {
        return false;
      }
      const workspaces = readAll<{ localPath: string }>(
        "select local_path as localPath from workspaces where company_id = ?",
        companyId,
      );
      if (workspaces.some((workspace) => isWithinOrEqual(resolvedTarget, safeRealpath(workspace.localPath)))) {
        return true;
      }
      const runLogs = readAll<{ logPath: string | null }>(
        "select log_path as logPath from runs where company_id = ? and log_path is not null",
        companyId,
      );
      if (runLogs.some((run) => run.logPath ? safeRealpath(run.logPath) === resolvedTarget : false)) {
        return true;
      }
      const browserScreenshots = readAll<{ screenshotPath: string | null }>(
        "select screenshot_path as screenshotPath from browser_actions where company_id = ? and screenshot_path is not null",
        companyId,
      );
      return browserScreenshots.some((action) => action.screenshotPath ? safeRealpath(action.screenshotPath) === resolvedTarget : false);
    },

    hasCompany(companyId: string) {
      const row = getDb().prepare("select id from companies where id = ?").get(companyId) as { id: string } | undefined;
      return Boolean(row);
    },

    belongsToCompany(table: "workspaces" | "agents" | "goals" | "projects" | "tasks" | "approvals" | "runs" | "secrets" | "meetings" | "documents" | "knowledge_base" | "sprints" | "automation_rules" | "workflow_pipelines", id: string, companyId: string) {
      const queries: Record<string, string> = {
        workspaces: "select 1 as present from workspaces where id = ? and company_id = ?",
        agents: "select 1 as present from agents where id = ? and company_id = ?",
        goals: "select 1 as present from goals where id = ? and company_id = ?",
        projects: "select 1 as present from projects where id = ? and company_id = ?",
        tasks: "select 1 as present from tasks where id = ? and company_id = ?",
        approvals: "select 1 as present from approvals where id = ? and company_id = ?",
        runs: "select 1 as present from runs where id = ? and company_id = ?",
        secrets: "select 1 as present from secrets where id = ? and company_id = ?",
        meetings: "select 1 as present from meetings where id = ? and company_id = ?",
        documents: "select 1 as present from documents where id = ? and company_id = ?",
        knowledge_base: "select 1 as present from knowledge_base where id = ? and company_id = ?",
        sprints: "select 1 as present from sprints where id = ? and company_id = ?",
        automation_rules: "select 1 as present from automation_rules where id = ? and company_id = ?",
        workflow_pipelines: "select 1 as present from workflow_pipelines where id = ? and company_id = ?",
      };
      const sql = queries[table];
      if (!sql) throw new Error(`Unknown table: ${table}`);
      const row = getDb().prepare(sql).get(id, companyId) as { present: number } | undefined;
      return Boolean(row?.present);
    },
  };
}
