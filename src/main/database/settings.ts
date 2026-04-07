import { existsSync, lstatSync, realpathSync, unlinkSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
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
  } catch {
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

    getDisabledModels(connectorId: string): Array<{ id: string; label: string }> {
      const raw = getSetting(`disabled_models:${connectorId}`);
      if (!raw) return [];
      try {
        return JSON.parse(raw);
      } catch {
        return raw.split(",").filter(Boolean).map((id) => ({ id, label: id }));
      }
    },

    setDisabledModels(connectorId: string, models: Array<{ id: string; label: string }>) {
      setSetting(`disabled_models:${connectorId}`, JSON.stringify(models));
    },

    hasModelPoolSettings(connectorId: string): boolean {
      return getSetting(`disabled_models:${connectorId}`) !== null;
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
          } catch { /* Log files may already be gone */ }
        }
        getDb()
          .prepare("update runs set log_path = null, updated_at = ? where id = ?")
          .run(nowIso(), run.id);
        purged++;
      }
      return purged;
    },

    canOpenPath(targetPath: string) {
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
      if (managedRoots.some((rootPath) => isWithinOrEqual(resolvedTarget, safeRealpath(rootPath)))) {
        return true;
      }
      const workspaces = readAll<{ localPath: string }>("select local_path as localPath from workspaces");
      if (workspaces.some((workspace) => isWithinOrEqual(resolvedTarget, safeRealpath(workspace.localPath)))) {
        return true;
      }
      const runLogs = readAll<{ logPath: string | null }>("select log_path as logPath from runs where log_path is not null");
      return runLogs.some((run) => run.logPath ? safeRealpath(run.logPath) === resolvedTarget : false);
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
