import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { buildThreadMethods } from "./database/threads";
import { buildCompanyMethods } from "./database/company";
import { buildAgentMethods } from "./database/agents";
import { buildTaskMethods } from "./database/tasks";
import { buildMessageMethods } from "./database/messages";
import { buildRunMethods } from "./database/runs";
import { buildSnapshotMethods } from "./database/snapshot";
import { buildSettingsMethods } from "./database/settings";
import { buildConnectorMethods } from "./database/connectors-crud";
import { buildWorkspaceMethods } from "./database/workspaces";
import { buildApprovalMethods } from "./database/approvals";
import { buildSocialMethods } from "./database/social";
import { buildActivityMethods } from "./database/activity";
import { buildSkillMethods } from "./database/skills";
import { buildBudgetMethods } from "./database/budget";
import { buildEntityCrudMethods } from "./database/entity-crud";
import { listInvalidEnvBindingKeys, parseEnvBindingText } from "./connectors";
import { buildDocumentMethods } from "./database/documents";
import { buildAutomationMethods } from "./database/automation";
import { buildKnowledgeMethods } from "./database/knowledge";
import { buildWakeupMethods } from "./database/wakeup";
import { buildBackupMethods } from "./database/backup";
import { buildSessionEntryMethods } from "./database/session-entries";
import { buildInboxProjectionMethods } from "./database/inbox-projections";
import { buildDocumentLifecycleEventMethods } from "./database/document-lifecycle-events";
import { buildCredentialMethods } from "./database/credentials";
import { buildModelCapabilityMethods } from "./database/model-capabilities-crud";
import { MODEL_CAPABILITY_SEED } from "./model-capability-seed";
import { initializeDatabase } from "./database/schema";
import { SecretVault } from "./vault";
import type { AgentStatus, ConnectorId, ProfileSnapshot, RunStatus } from "@shared/types";

function nowIso() {
  return new Date().toISOString();
}
export const STALE_LOCK_TIMEOUT_MS = 15 * 60 * 1000;

export class AppDatabaseBase {
  readonly profileDir: string;
  readonly dbPath: string;
  readonly logsDir: string;
  readonly artifactsDir: string;
  readonly backupsDir: string;
  readonly appVersion: string;
  readonly vault: SecretVault;
  protected db: DatabaseSync;

  // Domain modules. The canonical surface — call these directly from
  // every consumer (`db.tasks.saveTask(...)`, not `db.saveTask(...)`).
  // The ESLint rule in eslint.config.mjs blocks new top-level methods
  // on AppDatabase so the old pass-through layer cannot grow back.
  public readonly threads: ReturnType<typeof buildThreadMethods>;
  public readonly company: ReturnType<typeof buildCompanyMethods>;
  public readonly agents: ReturnType<typeof buildAgentMethods>;
  public readonly tasks: ReturnType<typeof buildTaskMethods>;
  public readonly messages: ReturnType<typeof buildMessageMethods>;
  public readonly runs: ReturnType<typeof buildRunMethods>;
  public readonly snap: ReturnType<typeof buildSnapshotMethods>;
  public readonly settings: ReturnType<typeof buildSettingsMethods>;
  public readonly connectorsCrud: ReturnType<typeof buildConnectorMethods>;
  public readonly workspacesMod: ReturnType<typeof buildWorkspaceMethods>;
  public readonly approvalsMod: ReturnType<typeof buildApprovalMethods>;
  public readonly social: ReturnType<typeof buildSocialMethods>;
  public readonly activityMod: ReturnType<typeof buildActivityMethods>;
  public readonly skills: ReturnType<typeof buildSkillMethods>;
  public readonly budget: ReturnType<typeof buildBudgetMethods>;
  public readonly entityCrud: ReturnType<typeof buildEntityCrudMethods>;
  public readonly documentsMod: ReturnType<typeof buildDocumentMethods>;
  public readonly automationMod: ReturnType<typeof buildAutomationMethods>;
  public readonly knowledgeMod: ReturnType<typeof buildKnowledgeMethods>;
  public readonly wakeup: ReturnType<typeof buildWakeupMethods>;
  public readonly backupMod: ReturnType<typeof buildBackupMethods>;
  public readonly sessionEntries: ReturnType<typeof buildSessionEntryMethods>;
  public readonly inboxProjections: ReturnType<typeof buildInboxProjectionMethods>;
  public readonly documentLifecycleEvents: ReturnType<typeof buildDocumentLifecycleEventMethods>;
  public readonly credentialsTable: ReturnType<typeof buildCredentialMethods>;
  public readonly modelCapabilities: ReturnType<typeof buildModelCapabilityMethods>;

  constructor(rootDir: string, options: { isPackaged?: boolean; appVersion?: string } = {}) {
    this.profileDir = rootDir;
    this.dbPath = join(rootDir, "profile.sqlite");
    this.logsDir = join(rootDir, "logs");
    this.artifactsDir = join(rootDir, "artifacts");
    this.backupsDir = join(rootDir, "backups");
    // Stamped into backup manifests so an operator looking at an old
    // snapshot can tell which build produced it. Callers (bootstrap)
    // pass `electron.app.getVersion()`; tests omit it.
    this.appVersion = options.appVersion ?? "unknown";
    mkdirSync(rootDir, { recursive: true });
    mkdirSync(this.logsDir, { recursive: true });
    mkdirSync(this.artifactsDir, { recursive: true });
    mkdirSync(this.backupsDir, { recursive: true });
    this.vault = new SecretVault(rootDir, { isPackaged: options.isPackaged });
    this.db = this.openConnection();

    const getDb = () => this.db;
    const ra = <T>(sql: string, ...params: SQLInputValue[]) => this.readAll<T>(sql, ...params);
    const tx = <T>(op: () => T) => this.transaction(op);

    this.activityMod = buildActivityMethods(getDb, ra);
    this.settings = buildSettingsMethods(getDb, ra, {
      profileDir: this.profileDir, logsDir: this.logsDir,
      artifactsDir: this.artifactsDir, backupsDir: this.backupsDir,
    });
    this.connectorsCrud = buildConnectorMethods(getDb, ra);
    this.snap = buildSnapshotMethods(getDb, ra, {
      getCurrentCompanyId: () => this.settings.getCurrentCompanyId(),
      getSetting: (key) => this.getSetting(key),
      readConnectors: () => this.connectorsCrud.readConnectors(),
      profileDir: this.profileDir,
      vaultBackendLabel: () => this.vault.getBackendLabel(),
    });
    this.threads = buildThreadMethods(getDb, ra);
    this.company = buildCompanyMethods(getDb, ra, tx, {
      getSetting: (key) => this.getSetting(key),
      setSetting: (key, value) => this.setSetting(key, value),
      listSnapshot: (options) => this.snap.listSnapshot(options),
      addComment: (input) => this.activityMod.addComment(input),
    });
    this.agents = buildAgentMethods(getDb, ra, tx, {
      getAgent: (id) => this.entityCrud.getAgent(id),
      wouldCreateAgentCycle: (agentId, reportsTo) => this.wouldCreateAgentCycle(agentId, reportsTo),
      recordConfigRevision: (input) => this.documentsMod.recordConfigRevision(input),
      cancelRunForDeletion: (runId, taskId, workspaceId, summary) => this.runs.cancelRunForDeletion(runId, taskId, workspaceId, summary),
      addActivity: (input) => this.activityMod.addActivity(input),
    });
    this.tasks = buildTaskMethods(getDb, ra, tx, {
      addComment: (input) => this.activityMod.addComment(input),
      addActivity: (input) => this.activityMod.addActivity(input),
      requestApproval: (input) => this.approvalsMod.requestApproval(input),
      setHeartbeat: (agentId, enabled, intervalSec) => this.agents.setHeartbeat(agentId, enabled, intervalSec),
    });
    this.messages = buildMessageMethods(getDb, ra, {
      getAgent: (id) => this.entityCrud.getAgent(id),
      addActivity: (input) => this.activityMod.addActivity(input),
      transaction: tx,
    });
    this.runs = buildRunMethods(getDb, ra, tx, { logsDir: this.logsDir });
    this.workspacesMod = buildWorkspaceMethods(getDb, ra, tx);
    this.approvalsMod = buildApprovalMethods(getDb, ra, tx, {
      getAgent: (id) => this.entityCrud.getAgent(id),
    });
    this.social = buildSocialMethods(getDb, ra, tx);
    this.skills = buildSkillMethods(getDb, ra);
    this.budget = buildBudgetMethods(getDb, ra, tx);
    this.entityCrud = buildEntityCrudMethods(getDb, ra, tx, {
      addActivity: (input) => this.activityMod.addActivity(input),
      vault: this.vault,
      listInvalidEnvBindingKeys,
      parseEnvBindingText,
    });
    this.documentsMod = buildDocumentMethods(getDb, ra, tx);
    this.automationMod = buildAutomationMethods(getDb, ra, {
      addActivity: (input) => this.activityMod.addActivity(input),
    });
    this.knowledgeMod = buildKnowledgeMethods(getDb, ra);
    this.wakeup = buildWakeupMethods(getDb, ra, tx);
    this.sessionEntries = buildSessionEntryMethods(getDb, ra, tx);
    this.inboxProjections = buildInboxProjectionMethods(getDb);
    this.documentLifecycleEvents = buildDocumentLifecycleEventMethods(getDb, ra);
    this.credentialsTable = buildCredentialMethods(getDb, ra, tx);
    this.modelCapabilities = buildModelCapabilityMethods(getDb, ra, tx);
    this.backupMod = buildBackupMethods({
      getDb, setDb: (db) => { this.db = db; },
      openConnection: () => this.openConnection(),
      init: () => this.init(),
      close: () => this.close(),
      profileDir: this.profileDir, dbPath: this.dbPath,
      logsDir: this.logsDir, artifactsDir: this.artifactsDir,
      backupsDir: this.backupsDir,
      appVersion: this.appVersion,
    });
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  init() {
    const ra = <T>(sql: string, ...params: SQLInputValue[]) => this.readAll<T>(sql, ...params);
    const tx = <T>(op: () => T) => this.transaction(op);
    initializeDatabase(this.db, ra, tx, (reason) => this.backupMod.createAutomaticBackup(reason));
    this.connectorsCrud.seedConnectors();
    this.modelCapabilities.seedModelCapabilities(MODEL_CAPABILITY_SEED);
    // Crash-recovery: a run still at `running` on boot means the worker
    // died mid-turn. Flip it to `interrupted`, surface the related task
    // as `blocked` for operator attention, and release workspace locks.
    // This is the only mutation the startup path is permitted to make;
    // all other "data-repair" passes have moved to explicit runtime
    // state-machine guards (see `tasks-status.ts`) or maintenance IPC.
    this._lastInterruptedCount = this.interruptStaleRuns();
    this.settings.purgeExpiredRunLogs();
    this.wakeup.purgeExpiredWakeupRequests();
  }

  close() { this.db.close(); }

  // ─── Internal helper: relock releaseAllWorkspaceLocks is used by
  //   crash-recovery below; callers should prefer
  //   `db.workspacesMod.releaseAllWorkspaceLocks()` directly.
  //
  // ─── Internal infrastructure ───────────────────────────────────────────────
  protected _lastInterruptedCount = 0;
  get lastInterruptedCount(): number { return this._lastInterruptedCount; }

  interruptStaleRuns(): number {
    const ts = nowIso();
    let interruptedCount = 0;
    this.transaction(() => {
      // Capture the run ids this sweep intends to interrupt BEFORE
      // mutating anything. The old code scoped the downstream task +
      // lease cleanup with `WHERE finished_at = ?` against the freshly
      // stamped timestamp — safe in isolation, but ISO-millisecond
      // ties with an earlier interrupted run are possible in principle
      // and would clean unrelated leases. Pinning the set to explicit
      // ids removes that dependency on timestamp uniqueness entirely.
      const staleRuns = this.db
        .prepare("SELECT id FROM runs WHERE status = 'running'")
        .all() as Array<{ id: string }>;
      if (staleRuns.length === 0) {
        // Nothing to interrupt; still let agent/workspace recovery run
        // so a boot that crashed while workers were already idle can
        // still reset agent rows parked at `status = 'running'`.
        this.db.prepare("update agents set status = 'idle', updated_at = ? where status = 'running'").run(ts);
        this.workspacesMod.releaseAllWorkspaceLocks();
        return;
      }
      const runIds = staleRuns.map((r) => r.id);
      const placeholders = runIds.map(() => "?").join(",");
      this.db
        .prepare(
          `update runs set status = 'interrupted', error_message = 'AgentCompany restarted before the run could report completion.', finished_at = ?, updated_at = ? where id in (${placeholders})`,
        )
        .run(ts, ts, ...runIds);
      interruptedCount = runIds.length;
      this.db
        .prepare(
          `update tasks set status = 'blocked', updated_at = ? where id in (select task_id from runs where id in (${placeholders})) and status in ('in_progress', 'todo')`,
        )
        .run(ts, ...runIds);
      this.db
        .prepare(
          `update tasks set active_run_id = null where active_run_id in (${placeholders})`,
        )
        .run(...runIds);
      this.db.prepare("update agents set status = 'idle', updated_at = ? where status = 'running'").run(ts);
      this.workspacesMod.releaseAllWorkspaceLocks();
    });
    return interruptedCount;
  }

  recoverStaleLocks(): Array<{ taskId: string; companyId: string; title: string }> {
    const cutoff = new Date(Date.now() - STALE_LOCK_TIMEOUT_MS).toISOString();
    const stale = this.readAll<{ id: string; companyId: string; title: string }>(
      `SELECT id, company_id AS companyId, title FROM tasks WHERE execution_locked_at IS NOT NULL AND execution_locked_at < ? AND status = 'in_progress' AND checkout_run_id NOT IN (SELECT id FROM runs WHERE status = 'running')`,
      cutoff,
    );
    const ts = nowIso();
    for (const task of stale) {
      this.db
        .prepare(
          `UPDATE tasks SET checkout_run_id = NULL, execution_locked_at = NULL, status = 'todo', updated_at = ? WHERE id = ?`,
        )
        .run(ts, task.id);
    }
    return stale.map((t) => ({ taskId: t.id, companyId: t.companyId, title: t.title }));
  }

  protected incrementActiveSprintVelocity(companyId: string, delta: number) {
    this.entityCrud.incrementActiveSprintVelocity(companyId, delta);
  }

  protected getSetting(key: string): string | null {
    const row = this.db.prepare("select value from settings where key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  protected setSetting(key: string, value: string) {
    this.db.prepare("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value").run(key, value);
  }

  protected readAll<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  protected wouldCreateAgentCycle(agentId: string, reportsTo: string | null) {
    if (!reportsTo) return false;
    if (reportsTo === agentId) return true;
    const visited = new Set<string>([agentId]);
    let currentId: string | null = reportsTo;
    while (currentId) {
      if (visited.has(currentId)) return true;
      visited.add(currentId);
      const current = this.db.prepare("select reports_to as reportsTo from agents where id = ?").get(currentId) as { reportsTo: string | null } | undefined;
      currentId = current?.reportsTo ?? null;
    }
    return false;
  }

  protected openConnection(): DatabaseSync {
    const db = new DatabaseSync(this.dbPath, { timeout: 5000 });
    db.exec("pragma journal_mode = WAL;");
    db.exec("pragma busy_timeout = 5000;");
    db.exec("pragma synchronous = NORMAL;");
    db.exec("pragma foreign_keys = ON;");
    return db;
  }

  protected transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /**
   * Run `operation` inside a `BEGIN IMMEDIATE` transaction. Public
   * surface for callers outside the database module that need to bind
   * multiple writes into one atomic unit — the inbox projection closure
   * is the canonical example, where the append to the session shadow,
   * the thread event, and the delivered-mark all have to commit
   * together or roll back together.
   */
  withTransaction<T>(operation: () => T): T {
    return this.transaction(operation);
  }

}
