import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  process.env.AGENTCOMPANY_ALLOW_INSECURE_VAULT = "true";
});

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => "basic_text",
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

import { AppDatabase } from "../../src/main/database";

const tempDirs: string[] = [];
const ts = "2026-04-24T00:00:00.000Z";

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function insertLegacyMigrationRows(db: DatabaseSync, maxVersion: number): void {
  db.exec("create table schema_migrations (version integer primary key, name text not null, applied_at text not null)");
  for (let version = 1; version <= maxVersion; version += 1) {
    db
      .prepare("insert into schema_migrations (version, name, applied_at) values (?, ?, ?)")
      .run(version, `legacy-${version}`, ts);
  }
}

function seedLegacyOperationalProfile(db: DatabaseSync): void {
  insertLegacyMigrationRows(db, 55);
  db.exec(`
    create table settings (key text primary key, value text not null);
    create table companies (id text primary key, name text not null, description text not null, status text not null, created_at text not null, updated_at text not null);
    create table agents (
      id text primary key,
      company_id text not null,
      name text not null,
      role text not null,
      title text not null,
      status text not null,
      reports_to text,
      connector_id text not null,
      workspace_id text,
      model text,
      capabilities text not null,
      budget_monthly_usd real not null default 0,
      spent_monthly_usd real not null default 0,
      metadata_json text not null default '{}',
      created_at text not null,
      updated_at text not null,
      department text
    );
    create table tasks (
      id text primary key,
      company_id text not null,
      title text not null,
      description text not null,
      assignee_agent_id text,
      workspace_id text,
      status text not null,
      priority text not null,
      active_run_id text,
      session_json text,
      session_display_id text,
      phase text,
      is_heartbeat integer not null default 0,
      created_at text not null,
      updated_at text not null
    );
    create table runs (
      id text primary key,
      company_id text not null,
      task_id text,
      agent_id text not null,
      workspace_id text,
      connector_id text not null,
      status text not null,
      summary text not null,
      unattributed_cost integer not null default 0,
      session_display_id text,
      context_snapshot_json text,
      created_at text not null,
      updated_at text not null
    );
    create table work_products (
      id text primary key,
      company_id text not null,
      project_id text,
      task_id text,
      type text not null,
      provider text not null,
      external_id text,
      title text not null,
      url text,
      status text not null default 'active',
      review_state text not null default 'none',
      is_primary integer not null default 0,
      summary text,
      metadata_json text,
      created_by_run_id text,
      created_at text not null,
      updated_at text not null,
      foreign key (task_id) references tasks(id) on delete cascade
    );
    create table pending_wakes (id text primary key, company_id text not null, agent_id text not null, trigger_reason text not null, created_at text not null);
    create table secrets (id text primary key, name text not null, description text not null, backend text not null, ciphertext blob not null, updated_at text not null, created_at text not null);
  `);
  db.prepare("insert into settings (key, value) values ('current_company_id', 'company-1')").run();
  db
    .prepare("insert into companies (id, name, description, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?)")
    .run("company-1", "Legacy Co", "", "active", ts, ts);
  db
    .prepare("insert into agents (id, company_id, name, role, title, status, reports_to, connector_id, workspace_id, model, capabilities, budget_monthly_usd, spent_monthly_usd, metadata_json, created_at, updated_at, department) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("agent-1", "company-1", "Engineer", "Engineer", "Engineer", "active", null, "openai-codex", null, null, "code", 12.34, 0, "{}", ts, ts, "engineering");
  db
    .prepare("insert into tasks (id, company_id, title, description, assignee_agent_id, workspace_id, status, priority, active_run_id, session_json, session_display_id, phase, is_heartbeat, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("task-1", "company-1", "Legacy task", "", "agent-1", "workspace-task", "todo", "medium", null, "{\"provider\":\"legacy\"}", "display-1", "todo", 0, ts, ts);
  db
    .prepare("insert into tasks (id, company_id, title, description, assignee_agent_id, workspace_id, status, priority, active_run_id, session_json, session_display_id, phase, is_heartbeat, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("heartbeat-task", "company-1", "[Heartbeat] agent-1", "", "agent-1", "workspace-task", "in_progress", "low", "run-heartbeat", null, null, "in_progress", 1, ts, ts);
  db
    .prepare("insert into runs (id, company_id, task_id, agent_id, workspace_id, connector_id, status, summary, unattributed_cost, session_display_id, context_snapshot_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("run-heartbeat", "company-1", "heartbeat-task", "agent-1", "workspace-task", "openai-codex", "running", "", 0, "run-display", "{}", ts, ts);
  db
    .prepare("insert into runs (id, company_id, task_id, agent_id, workspace_id, connector_id, status, summary, unattributed_cost, session_display_id, context_snapshot_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("run-product", "company-1", null, "agent-1", "workspace-run", "openai-codex", "done", "", 0, "run-display-2", "{}", ts, ts);
  db
    .prepare("insert into runs (id, company_id, task_id, agent_id, workspace_id, connector_id, status, summary, unattributed_cost, session_display_id, context_snapshot_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("run-cancelled", "company-1", null, "agent-1", "workspace-run", "openai-codex", "cancelled", "", 1, "run-display-3", "{}", ts, ts);
  db
    .prepare("insert into work_products (id, company_id, task_id, type, provider, external_id, title, status, review_state, is_primary, created_by_run_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("wp-task", "company-1", "task-1", "file", "filesystem", "task.md", "Task file", "active", "none", 1, null, ts, ts);
  db
    .prepare("insert into work_products (id, company_id, task_id, type, provider, external_id, title, status, review_state, is_primary, created_by_run_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("wp-run", "company-1", null, "file", "filesystem", "run.md", "Run file", "active", "none", 0, "run-product", ts, ts);
  db
    .prepare("insert into pending_wakes (id, company_id, agent_id, trigger_reason, created_at) values (?, ?, ?, ?, ?)")
    .run("wake-1", "company-1", "agent-1", "manual", ts);
  db
    .prepare("insert into secrets (id, name, description, backend, ciphertext, updated_at, created_at) values (?, ?, ?, ?, ?, ?, ?)")
    .run("secret-1", "api", "API key", "safeStorage", Buffer.from("encrypted"), ts, ts);
}

describe("legacy to v56 baseline migration", () => {
  it("migrates legacy data helpers and compresses schema history", async () => {
    const profileDir = await createTempDir("agentcompany-legacy-baseline-");
    const rawDb = new DatabaseSync(join(profileDir, "profile.sqlite"));
    try {
      seedLegacyOperationalProfile(rawDb);
    } finally {
      rawDb.close();
    }

    let appDb = new AppDatabase(profileDir);
    appDb.init();
    try {
      expect(appDb.queryAll("select version, name from schema_migrations")).toEqual([
        { version: 56, name: "baseline_v56" },
      ]);
      expect(appDb.queryAll<{ companyId: string }>("select company_id as companyId from secrets where id = 'secret-1'")[0])
        .toEqual({ companyId: "company-1" });
      expect(appDb.queryAll<{ source: string; triggerDetail: string }>("select source, trigger_detail as triggerDetail from wakeup_requests where id = 'wake-1'")[0])
        .toEqual({ source: "manual", triggerDetail: JSON.stringify([{ trigger: "manual", at: ts, detail: "manual" }]) });
      expect(appDb.queryAll<{ amount: number }>("select amount from budget_policies where scope_type = 'agent' and scope_id = 'agent-1'")[0])
        .toEqual({ amount: 1234 });
      expect(appDb.queryAll<{ agentId: string; adapterType: string }>("select agent_id as agentId, adapter_type as adapterType from task_sessions")[0])
        .toEqual({ agentId: "agent-1", adapterType: "openai-codex" });
      expect(appDb.queryAll("select id from tasks where id = 'heartbeat-task'")).toEqual([]);
      expect(appDb.queryAll<{ taskId: string | null }>("select task_id as taskId from runs where id = 'run-heartbeat'")[0])
        .toEqual({ taskId: null });
      expect(appDb.queryAll<{ id: string; usageStatus: string }>("select id, usage_status as usageStatus from runs where id in ('run-product', 'run-cancelled') order by id"))
        .toEqual([
          { id: "run-cancelled", usageStatus: "aborted_before_usage" },
          { id: "run-product", usageStatus: "ok" },
        ]);
      expect(appDb.queryAll<{ id: string; workspaceId: string | null; lastTouchedByRunId: string | null }>("select id, workspace_id as workspaceId, last_touched_by_run_id as lastTouchedByRunId from work_products order by id"))
        .toEqual([
          { id: "wp-run", workspaceId: "workspace-run", lastTouchedByRunId: "run-product" },
          { id: "wp-task", workspaceId: "workspace-task", lastTouchedByRunId: null },
        ]);
    } finally {
      appDb.close();
    }

    appDb = new AppDatabase(profileDir);
    appDb.init();
    try {
      expect(appDb.queryAll("select version, name from schema_migrations")).toEqual([
        { version: 56, name: "baseline_v56" },
      ]);
      expect(appDb.queryAll("select id from budget_policies where scope_type = 'agent' and scope_id = 'agent-1'"))
        .toHaveLength(1);
    } finally {
      appDb.close();
    }
  });

  it("rolls back when a legacy table would drop an unknown column", async () => {
    const profileDir = await createTempDir("agentcompany-legacy-rollback-");
    const rawDb = new DatabaseSync(join(profileDir, "profile.sqlite"));
    try {
      insertLegacyMigrationRows(rawDb, 1);
      rawDb.exec(`
        create table companies (
          id text primary key,
          name text not null,
          description text not null,
          status text not null,
          created_at text not null,
          updated_at text not null,
          rogue_payload text not null
        );
      `);
      rawDb
        .prepare("insert into companies (id, name, description, status, created_at, updated_at, rogue_payload) values (?, ?, ?, ?, ?, ?, ?)")
        .run("company-1", "Legacy Co", "", "active", ts, ts, "keep");
    } finally {
      rawDb.close();
    }

    const appDb = new AppDatabase(profileDir);
    try {
      expect(() => appDb.init()).toThrow(/unexpected legacy columns/);
      expect(appDb.queryAll<{ name: string }>("pragma table_info(companies)").map((row) => row.name))
        .toContain("rogue_payload");
      expect(appDb.queryAll("select version from schema_migrations")).toEqual([{ version: 1 }]);
    } finally {
      appDb.close();
    }
  });

  it("rolls back v56 compression when baseline drift is detected", async () => {
    const profileDir = await createTempDir("agentcompany-v56-drift-rollback-");
    const rawDb = new DatabaseSync(join(profileDir, "profile.sqlite"));
    try {
      rawDb.exec(`
        create table schema_migrations (version integer primary key, name text not null, applied_at text not null);
        insert into schema_migrations (version, name, applied_at) values (55, 'legacy-55', '${ts}');
        insert into schema_migrations (version, name, applied_at) values (56, 'legacy-56', '${ts}');
        create table companies (id text primary key, name text not null);
      `);
    } finally {
      rawDb.close();
    }

    const appDb = new AppDatabase(profileDir);
    try {
      expect(() => appDb.init()).toThrow(/Baseline v56 table drift/);
      expect(appDb.queryAll("select version, name from schema_migrations order by version")).toEqual([
        { version: 55, name: "legacy-55" },
        { version: 56, name: "legacy-56" },
      ]);
      expect(appDb.queryAll("select name from sqlite_master where type = 'table' and name = 'agents'")).toEqual([]);
    } finally {
      appDb.close();
    }
  });

  it("migrates task session rows through the old task-scoped table shape", async () => {
    const profileDir = await createTempDir("agentcompany-old-task-sessions-");
    const rawDb = new DatabaseSync(join(profileDir, "profile.sqlite"));
    try {
      insertLegacyMigrationRows(rawDb, 40);
      rawDb.exec(`
        create table settings (key text primary key, value text not null);
        create table companies (id text primary key, name text not null, description text not null, status text not null, created_at text not null, updated_at text not null);
        create table agents (
          id text primary key,
          company_id text not null,
          name text not null,
          role text not null,
          title text not null,
          status text not null,
          reports_to text,
          connector_id text not null,
          workspace_id text,
          model text,
          capabilities text not null,
          budget_monthly_usd real not null default 0,
          spent_monthly_usd real not null default 0,
          metadata_json text not null default '{}',
          created_at text not null,
          updated_at text not null
        );
        create table tasks (
          id text primary key,
          company_id text not null,
          title text not null,
          description text not null,
          assignee_agent_id text,
          status text not null,
          priority text not null,
          session_json text,
          session_display_id text,
          active_session_id text,
          created_at text not null,
          updated_at text not null
        );
        create table task_sessions (
          id text primary key,
          company_id text not null,
          task_id text not null,
          agent_id text not null,
          adapter_type text not null,
          session_params_json text,
          session_display_id text,
          created_at text not null,
          updated_at text not null
        );
      `);
      rawDb
        .prepare("insert into companies (id, name, description, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?)")
        .run("company-1", "Legacy Co", "", "active", ts, ts);
      rawDb
        .prepare("insert into agents (id, company_id, name, role, title, status, reports_to, connector_id, workspace_id, model, capabilities, budget_monthly_usd, spent_monthly_usd, metadata_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run("agent-1", "company-1", "Engineer", "Engineer", "Engineer", "active", null, "openai-codex", null, null, "code", 0, 0, "{}", ts, ts);
      rawDb
        .prepare("insert into tasks (id, company_id, title, description, assignee_agent_id, status, priority, session_json, session_display_id, active_session_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run("task-1", "company-1", "Legacy task", "", "agent-1", "todo", "medium", "{\"provider\":\"legacy\"}", "display-1", null, ts, ts);
    } finally {
      rawDb.close();
    }

    const appDb = new AppDatabase(profileDir);
    appDb.init();
    try {
      expect(appDb.queryAll<{ name: string }>("pragma table_info(task_sessions)").map((row) => row.name))
        .toEqual([
          "id",
          "company_id",
          "agent_id",
          "adapter_type",
          "last_run_id",
          "last_error",
          "run_count",
          "total_input_tokens",
          "total_output_tokens",
          "rotated_at",
          "rotation_reason",
          "handoff_markdown",
          "created_at",
          "updated_at",
        ]);
      expect(appDb.queryAll<{ agentId: string; adapterType: string }>("select agent_id as agentId, adapter_type as adapterType from task_sessions"))
        .toEqual([{ agentId: "agent-1", adapterType: "openai-codex" }]);
      expect(appDb.queryAll("select version, name from schema_migrations")).toEqual([
        { version: 56, name: "baseline_v56" },
      ]);
    } finally {
      appDb.close();
    }
  });
});
