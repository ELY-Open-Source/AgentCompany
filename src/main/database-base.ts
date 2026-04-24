import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
import { buildCredentialMethods, type CredentialBackend } from "./database/credentials";
import { BOSS_FIREWORKS_API_KEY } from "./boss-seed";
import { buildModelCapabilityMethods } from "./database/model-capabilities-crud";
import { MODEL_CAPABILITY_SEED } from "./model-capability-seed";
import { initializeDatabase } from "./database/schema";
import { SecretVault } from "./vault";

function nowIso() {
  return new Date().toISOString();
}

function assertWritableDirectory(dir: string, label: string): void {
  const probePath = join(dir, `.agentcompany-${label}-write-probe-${process.pid}-${Date.now()}`);
  try {
    writeFileSync(probePath, "", { encoding: "utf8", flag: "wx" });
  } finally {
    rmSync(probePath, { force: true });
  }
}

export interface AppDatabaseCoreModules {
  threads: ReturnType<typeof buildThreadMethods>;
  company: ReturnType<typeof buildCompanyMethods>;
  agents: ReturnType<typeof buildAgentMethods>;
  tasks: ReturnType<typeof buildTaskMethods>;
  messages: ReturnType<typeof buildMessageMethods>;
  runs: ReturnType<typeof buildRunMethods>;
  settings: ReturnType<typeof buildSettingsMethods>;
  connectors: ReturnType<typeof buildConnectorMethods>;
  workspaces: ReturnType<typeof buildWorkspaceMethods>;
  approvals: ReturnType<typeof buildApprovalMethods>;
  social: ReturnType<typeof buildSocialMethods>;
  activity: ReturnType<typeof buildActivityMethods>;
  skills: ReturnType<typeof buildSkillMethods>;
  budget: ReturnType<typeof buildBudgetMethods>;
  entity: ReturnType<typeof buildEntityCrudMethods>;
  documents: ReturnType<typeof buildDocumentMethods>;
  knowledge: ReturnType<typeof buildKnowledgeMethods>;
  backup: ReturnType<typeof buildBackupMethods>;
  credentials: ReturnType<typeof buildCredentialMethods>;
  modelCapabilities: ReturnType<typeof buildModelCapabilityMethods>;
}

export interface AppDatabaseAutomationModules {
  rules: ReturnType<typeof buildAutomationMethods>;
  wakeup: ReturnType<typeof buildWakeupMethods>;
}

export interface AppDatabaseProjectionModules {
  snapshot: ReturnType<typeof buildSnapshotMethods>;
  sessionEntries: ReturnType<typeof buildSessionEntryMethods>;
  inbox: ReturnType<typeof buildInboxProjectionMethods>;
  documentLifecycleEvents: ReturnType<typeof buildDocumentLifecycleEventMethods>;
}

export class AppDatabaseBase {
  readonly profileDir: string;
  readonly dbPath: string;
  readonly logsDir: string;
  readonly artifactsDir: string;
  readonly backupsDir: string;
  readonly appVersion: string;
  readonly vault: SecretVault;
  protected db: DatabaseSync;
  private transactionDepth = 0;
  private savepointCounter = 0;

  public readonly core: AppDatabaseCoreModules;
  public readonly automation: AppDatabaseAutomationModules;
  public readonly projection: AppDatabaseProjectionModules;

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
    assertWritableDirectory(this.logsDir, "logs");
    mkdirSync(this.artifactsDir, { recursive: true });
    mkdirSync(this.backupsDir, { recursive: true });
    this.vault = new SecretVault(rootDir, { isPackaged: options.isPackaged });
    this.db = this.openConnection();

    const getDb = () => this.db;
    const ra = <T>(sql: string, ...params: SQLInputValue[]) => this.readAll<T>(sql, ...params);
    const tx = <T>(op: () => T) => this.transaction(op);

    const activity = buildActivityMethods(getDb, ra);
    const settings = buildSettingsMethods(getDb, ra, {
      profileDir: this.profileDir, logsDir: this.logsDir,
      artifactsDir: this.artifactsDir, backupsDir: this.backupsDir,
    });
    const connectors = buildConnectorMethods(getDb, ra);
    const snapshot = buildSnapshotMethods(getDb, ra, {
      getCurrentCompanyId: () => settings.getCurrentCompanyId(),
      getSetting: (key) => this.getSetting(key),
      readConnectors: () => connectors.readConnectors(),
      profileDir: this.profileDir,
      vaultBackendLabel: () => this.vault.getBackendLabel(),
    });
    const threads = buildThreadMethods(getDb, ra);
    const entity = buildEntityCrudMethods(getDb, ra, tx, {
      addActivity: (input) => activity.addActivity(input),
      vault: this.vault,
      listInvalidEnvBindingKeys,
      parseEnvBindingText,
    });
    const documents = buildDocumentMethods(getDb, ra, tx);
    const runs = buildRunMethods(getDb, ra, tx, { logsDir: this.logsDir });
    const company = buildCompanyMethods(getDb, ra, tx, {
      getSetting: (key) => this.getSetting(key),
      setSetting: (key, value) => this.setSetting(key, value),
      listSnapshot: (options) => snapshot.listSnapshot(options),
      addComment: (input) => activity.addComment(input),
    });
    const agents = buildAgentMethods(getDb, ra, tx, {
      getAgent: (id) => entity.getAgent(id),
      wouldCreateAgentCycle: (agentId, reportsTo) => this.wouldCreateAgentCycle(agentId, reportsTo),
      recordConfigRevision: (input) => documents.recordConfigRevision(input),
      cancelRunForDeletion: (runId, taskId, workspaceId, summary) => runs.cancelRunForDeletion(runId, taskId, workspaceId, summary),
      addActivity: (input) => activity.addActivity(input),
    });
    const approvals = buildApprovalMethods(getDb, ra, tx, {
      getAgent: (id) => entity.getAgent(id),
    });
    const tasks = buildTaskMethods(getDb, ra, tx, {
      addComment: (input) => activity.addComment(input),
      addActivity: (input) => activity.addActivity(input),
      requestApproval: (input) => approvals.requestApproval(input),
      setHeartbeat: (agentId, enabled, intervalSec) => agents.setHeartbeat(agentId, enabled, intervalSec),
    });
    const messages = buildMessageMethods(getDb, ra, {
      getAgent: (id) => entity.getAgent(id),
      addActivity: (input) => activity.addActivity(input),
      transaction: tx,
    });
    const workspaces = buildWorkspaceMethods(getDb, ra, tx);
    const social = buildSocialMethods(getDb, ra, tx);
    const skills = buildSkillMethods(getDb, ra);
    const budget = buildBudgetMethods(getDb, ra, tx);
    const automationRules = buildAutomationMethods(getDb, ra, {
      addActivity: (input) => activity.addActivity(input),
    });
    const knowledge = buildKnowledgeMethods(getDb, ra);
    const wakeup = buildWakeupMethods(getDb, ra, tx);
    const sessionEntries = buildSessionEntryMethods(getDb, ra, tx);
    const inbox = buildInboxProjectionMethods(getDb);
    const documentLifecycleEvents = buildDocumentLifecycleEventMethods(getDb, ra);
    const credentials = buildCredentialMethods(getDb, ra, tx);
    const modelCapabilities = buildModelCapabilityMethods(getDb, ra, tx);
    const backup = buildBackupMethods({
      getDb, setDb: (db) => { this.db = db; },
      openConnection: () => this.openConnection(),
      init: () => this.init(),
      close: () => this.close(),
      profileDir: this.profileDir, dbPath: this.dbPath,
      logsDir: this.logsDir, artifactsDir: this.artifactsDir,
      backupsDir: this.backupsDir,
      appVersion: this.appVersion,
    });

    this.core = {
      threads,
      company,
      agents,
      tasks,
      messages,
      runs,
      settings,
      connectors,
      workspaces,
      approvals,
      social,
      activity,
      skills,
      budget,
      entity,
      documents,
      knowledge,
      backup,
      credentials,
      modelCapabilities,
    };
    this.automation = { rules: automationRules, wakeup };
    this.projection = { snapshot, sessionEntries, inbox, documentLifecycleEvents };
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  init() {
    const ra = <T>(sql: string, ...params: SQLInputValue[]) => this.readAll<T>(sql, ...params);
    const tx = <T>(op: () => T) => this.transaction(op);
    initializeDatabase(this.db, ra, tx, (reason) => this.core.backup.createAutomaticBackup(reason));
    this.core.connectors.seedConnectors();
    this.seedBossFireworksCredential();
    this.core.modelCapabilities.seedModelCapabilities(MODEL_CAPABILITY_SEED);
    // Crash-recovery: a run still at `running` on boot means the worker
    // died mid-turn. Flip it to `interrupted`, surface the related task
    // as `blocked` for operator attention, and release workspace locks.
    // This is the only mutation the startup path is permitted to make;
    // all other "data-repair" passes have moved to explicit runtime
    // state-machine guards (see `tasks-status.ts`) or maintenance IPC.
    this._lastInterruptedCount = this.interruptStaleRuns();
    this.core.settings.purgeExpiredRunLogs();
    this.automation.wakeup.purgeExpiredWakeupRequests();
  }

  close() { this.db.close(); }

  // Boss edition bootstraps the Fireworks Fire Pass credential so the
  // onboarding card renders as "active" on first launch. Public builds leave
  // `BOSS_FIREWORKS_API_KEY` empty and this call is a no-op. Guard against
  // overwriting an existing credential so upgrades and user edits survive.
  private seedBossFireworksCredential() {
    if (!BOSS_FIREWORKS_API_KEY) return;
    const connectorId = "fireworks-firepass";
    if (this.core.credentials.get(connectorId)) return;
    const payload = JSON.stringify({ source: "literal", value: BOSS_FIREWORKS_API_KEY });
    const { backend, payload: ciphertext } = this.vault.encrypt(payload);
    this.core.credentials.upsert({
      connectorId,
      kind: "api_key",
      backend: backend as CredentialBackend,
      ciphertext,
      displayHint: `${BOSS_FIREWORKS_API_KEY.slice(0, 6)}...${BOSS_FIREWORKS_API_KEY.slice(-4)}`,
      status: "active",
    });
  }

  // ─── Internal helper: relock releaseAllWorkspaceLocks is used by
  //   crash-recovery below; callers should prefer
  //   `db.core.workspaces.releaseAllWorkspaceLocks()` directly.
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
        this.core.workspaces.releaseAllWorkspaceLocks();
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
          `delete from task_leases where run_id in (${placeholders})`,
        )
        .run(...runIds);
      this.db.prepare("update agents set status = 'idle', updated_at = ? where status = 'running'").run(ts);
      this.core.workspaces.releaseAllWorkspaceLocks();
    });
    return interruptedCount;
  }

  recoverStaleLocks(): Array<{ taskId: string; companyId: string; title: string }> {
    const now = new Date().toISOString();
    const stale = this.readAll<{ id: string; companyId: string; title: string }>(
      `SELECT t.id, t.company_id AS companyId, t.title
         FROM task_leases l
         JOIN tasks t ON t.id = l.task_id
         LEFT JOIN runs r ON r.id = l.run_id
        WHERE l.expires_at < ?
          AND t.status = 'in_progress'
          AND (r.id IS NULL OR r.status != 'running')`,
      now,
    );
    const ts = nowIso();
    for (const task of stale) {
      this.db.prepare("delete from task_leases where task_id = ?").run(task.id);
      this.db
        .prepare(
          `UPDATE tasks SET status = 'todo', updated_at = ? WHERE id = ?`,
        )
        .run(ts, task.id);
    }
    return stale.map((t) => ({ taskId: t.id, companyId: t.companyId, title: t.title }));
  }

  protected incrementActiveSprintVelocity(companyId: string, delta: number) {
    this.core.entity.incrementActiveSprintVelocity(companyId, delta);
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
    if (this.transactionDepth > 0) {
      const savepoint = `agentcompany_tx_${this.savepointCounter}`;
      this.savepointCounter += 1;
      this.db.exec(`SAVEPOINT ${savepoint}`);
      this.transactionDepth += 1;
      try {
        const result = operation();
        this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        this.db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        this.db.exec(`RELEASE SAVEPOINT ${savepoint}`);
        throw error;
      } finally {
        this.transactionDepth -= 1;
      }
    }

    this.db.exec("BEGIN IMMEDIATE");
    this.transactionDepth += 1;
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.transactionDepth -= 1;
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
