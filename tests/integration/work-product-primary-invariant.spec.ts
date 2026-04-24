import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../../src/main/database";
import type { WorkProductType } from "../../src/shared/types";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createHarness() {
  const profileDir = await createTempDir("agentcompany-primary-wp-");
  const db = new AppDatabase(profileDir);
  db.init();
  const companyId = db.core.company.saveCompany({
    name: "Primary Work Product Co",
    description: "Tests primary invariant",
    status: "active",
  });
  const agentId = db.core.agents.saveAgent({
    companyId,
    name: "Writer",
    role: "Engineer",
    title: "Writer",
    status: "active",
    reportsTo: null,
    connectorId: "openai-codex",
    model: null,
    capabilities: "Writes artifacts",
    budgetMonthlyUsd: 100,
  });
  const taskId = db.core.tasks.saveTask({
    companyId,
    title: "Create deliverables",
    description: "",
    assigneeAgentId: agentId,
    priority: "medium",
    status: "in_progress",
  });
  return { db, companyId, taskId };
}

function createWorkProduct(db: AppDatabase, companyId: string, taskId: string, title: string, isPrimary = false, type: WorkProductType = "file") {
  return db.core.documents.createWorkProduct({
    companyId,
    taskId,
    type,
    provider: "filesystem",
    externalId: `${title}.md`,
    title,
    isPrimary,
  });
}

function listPrimaryIds(db: AppDatabase, companyId: string, taskId: string) {
  return listPrimaryIdsByType(db, companyId, taskId, "file");
}

function listPrimaryIdsByType(db: AppDatabase, companyId: string, taskId: string, type: string) {
  return db.queryAll<{ id: string }>(
    "select id from work_products where company_id = ? and task_id = ? and type = ? and is_primary = 1 and status <> 'archived' order by updated_at desc",
    companyId,
    taskId,
    type,
  ).map((row) => row.id);
}

describe("work product primary invariant", () => {
  it("installs the database unique index for active primary rows", async () => {
    const { db } = await createHarness();
    try {
      const index = db.queryAll<{ sql: string | null }>(
        "select sql from sqlite_master where type = 'index' and name = 'idx_work_products_primary_active' limit 1",
      )[0];
      expect(index?.sql).toContain("ON work_products(company_id, task_id, type)");
      expect(index?.sql).toContain("is_primary = 1");
      expect(index?.sql).toContain("status <> 'archived'");
    } finally {
      db.close();
    }
  });

  it("normalizes duplicate active primaries during v56 migration", async () => {
    const profileDir = await createTempDir("agentcompany-primary-migration-");
    const dbPath = join(profileDir, "profile.sqlite");
    const rawDb = new DatabaseSync(dbPath);
    const ts = "2026-04-24T00:00:00.000Z";
    try {
      rawDb.exec(`
        create table settings (key text primary key, value text not null);
        create table companies (id text primary key, name text not null, description text not null, status text not null, created_at text not null, updated_at text not null);
        create table agents (id text primary key, company_id text not null, status text not null, reports_to text, department text, connector_id text not null default 'openai-codex', updated_at text not null);
        create table workspaces (id text primary key, company_id text not null, local_path text not null, state text not null, lock_holder_run_id text, lock_acquired_at text, updated_at text not null);
        create table agent_messages (id text primary key, company_id text not null, channel text not null, channel_target_id text, created_at text not null);
        create table model_capabilities (
          provider TEXT NOT NULL,
          model_id TEXT NOT NULL,
          reasoning INTEGER NOT NULL,
          coding INTEGER NOT NULL,
          writing INTEGER NOT NULL,
          tier TEXT NOT NULL,
          cost_per_mtok_out REAL NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (provider, model_id)
        );
        create table work_products (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          project_id TEXT,
          task_id TEXT,
          workspace_id TEXT,
          type TEXT NOT NULL,
          provider TEXT NOT NULL,
          external_id TEXT,
          title TEXT NOT NULL,
          url TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          review_state TEXT NOT NULL DEFAULT 'none',
          is_primary INTEGER NOT NULL DEFAULT 0,
          summary TEXT,
          metadata_json TEXT,
          created_by_run_id TEXT,
          last_touched_by_run_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        create table schema_migrations (version integer primary key, name text not null, applied_at text not null);
      `);
      for (let version = 1; version <= 55; version += 1) {
        rawDb
          .prepare("insert into schema_migrations (version, name, applied_at) values (?, ?, ?)")
          .run(version, `legacy-${version}`, ts);
      }
      rawDb
        .prepare("insert into companies (id, name, description, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?)")
        .run("company-1", "Legacy Co", "", "active", ts, ts);
      rawDb
        .prepare("insert into work_products (id, company_id, task_id, type, provider, external_id, title, status, review_state, is_primary, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run("older-primary", "company-1", "task-1", "file", "filesystem", "older.md", "Older", "active", "none", 1, "2026-04-24T00:00:01.000Z", "2026-04-24T00:00:01.000Z");
      rawDb
        .prepare("insert into work_products (id, company_id, task_id, type, provider, external_id, title, status, review_state, is_primary, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run("newer-primary", "company-1", "task-1", "file", "filesystem", "newer.md", "Newer", "active", "none", 1, "2026-04-24T00:00:02.000Z", "2026-04-24T00:00:02.000Z");
    } finally {
      rawDb.close();
    }

    const appDb = new AppDatabase(profileDir);
    appDb.init();
    try {
      expect(listPrimaryIdsByType(appDb, "company-1", "task-1", "file")).toEqual(["newer-primary"]);
      const older = appDb.queryAll<{ isPrimary: number }>("select is_primary as isPrimary from work_products where id = 'older-primary'")[0];
      expect(older?.isPrimary).toBe(0);
      const migration = appDb.queryAll<{ version: number }>("select version from schema_migrations where version = 56")[0];
      expect(migration?.version).toBe(56);
      const index = appDb.queryAll<{ sql: string | null }>(
        "select sql from sqlite_master where type = 'index' and name = 'idx_work_products_primary_active' limit 1",
      )[0];
      expect(index?.sql).toContain("idx_work_products_primary_active");
    } finally {
      appDb.close();
    }
  });

  it("rejects direct SQL writes that violate the primary invariant", async () => {
    const { db, companyId, taskId } = await createHarness();
    try {
      createWorkProduct(db, companyId, taskId, "first", true);
      expect(() => db.queryAll(
        `insert into work_products (
          id, company_id, task_id, type, provider, external_id, title, status, review_state, is_primary, created_at, updated_at
        ) values (
          'direct-primary', ?, ?, 'file', 'filesystem', 'direct.md', 'Direct', 'active', 'none', 1, '2026-04-24T00:00:00.000Z', '2026-04-24T00:00:00.000Z'
        )`,
        companyId,
        taskId,
      )).toThrow(/UNIQUE constraint failed/);
    } finally {
      db.close();
    }
  });

  it("moves primary status when PATCH promotes another work product", async () => {
    const { db, companyId, taskId } = await createHarness();
    try {
      const firstId = createWorkProduct(db, companyId, taskId, "first", true);
      const secondId = createWorkProduct(db, companyId, taskId, "second", false);

      db.core.documents.updateWorkProduct(secondId, companyId, { isPrimary: true });

      expect(listPrimaryIds(db, companyId, taskId)).toEqual([secondId]);
      const first = db.queryAll<{ isPrimary: number }>("select is_primary as isPrimary from work_products where id = ?", firstId)[0];
      expect(first?.isPrimary).toBe(0);
    } finally {
      db.close();
    }
  });

  it("keeps the primary invariant when create inserts a new primary", async () => {
    const { db, companyId, taskId } = await createHarness();
    try {
      const firstId = createWorkProduct(db, companyId, taskId, "first", true);
      const secondId = createWorkProduct(db, companyId, taskId, "second", true);

      expect(listPrimaryIds(db, companyId, taskId)).toEqual([secondId]);
      const first = db.queryAll<{ isPrimary: number }>("select is_primary as isPrimary from work_products where id = ?", firstId)[0];
      expect(first?.isPrimary).toBe(0);
    } finally {
      db.close();
    }
  });

  it("moves primary status when a primary work product changes type", async () => {
    const { db, companyId, taskId } = await createHarness();
    try {
      const firstId = createWorkProduct(db, companyId, taskId, "first", true, "file");
      const secondId = createWorkProduct(db, companyId, taskId, "second", true, "link");

      db.core.documents.updateWorkProduct(firstId, companyId, { type: "link" });

      expect(listPrimaryIdsByType(db, companyId, taskId, "link")).toEqual([firstId]);
      const second = db.queryAll<{ isPrimary: number }>("select is_primary as isPrimary from work_products where id = ?", secondId)[0];
      expect(second?.isPrimary).toBe(0);
    } finally {
      db.close();
    }
  });
});
