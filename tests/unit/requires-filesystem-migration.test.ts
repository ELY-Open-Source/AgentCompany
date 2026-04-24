import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("legacy to v56 baseline migration", () => {
  it("materializes legacy role evidence into the task filesystem policy", async () => {
    const profileDir = await createTempDir("agentcompany-requires-fs-legacy-");
    const rawDb = new DatabaseSync(join(profileDir, "profile.sqlite"));
    const ts = "2026-04-24T00:00:00.000Z";
    try {
      rawDb.exec(`
        create table schema_migrations (version integer primary key, name text not null, applied_at text not null);
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
          project_id text,
          goal_id text,
          parent_id text,
          title text not null,
          description text not null,
          assignee_agent_id text,
          workspace_id text,
          status text not null,
          priority text not null,
          active_run_id text,
          cost_usd real not null default 0,
          created_at text not null,
          updated_at text not null
        );
      `);
      for (let version = 1; version <= 51; version += 1) {
        rawDb
          .prepare("insert into schema_migrations (version, name, applied_at) values (?, ?, ?)")
          .run(version, `legacy-${version}`, ts);
      }
      rawDb
        .prepare("insert into companies (id, name, description, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?)")
        .run("company-1", "Legacy Co", "", "active", ts, ts);
      rawDb
        .prepare("insert into agents (id, company_id, name, role, title, status, reports_to, connector_id, workspace_id, model, capabilities, budget_monthly_usd, spent_monthly_usd, metadata_json, created_at, updated_at, department) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run("agent-cto", "company-1", "CTO", "CTO", "CTO", "active", null, "openai-codex", null, null, "code", 0, 0, "{}", ts, ts, "engineering");
      rawDb
        .prepare("insert into agents (id, company_id, name, role, title, status, reports_to, connector_id, workspace_id, model, capabilities, budget_monthly_usd, spent_monthly_usd, metadata_json, created_at, updated_at, department) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run("agent-cmo", "company-1", "CMO", "CMO", "CMO", "active", null, "openai-codex", null, null, "market", 0, 0, "{}", ts, ts, "marketing");
      rawDb
        .prepare("insert into tasks (id, company_id, title, description, assignee_agent_id, status, priority, active_run_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run("task-coding", "company-1", "Coding", "", "agent-cto", "todo", "medium", null, ts, ts);
      rawDb
        .prepare("insert into tasks (id, company_id, title, description, assignee_agent_id, status, priority, active_run_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run("task-cognitive", "company-1", "Strategy", "", "agent-cmo", "todo", "medium", null, ts, ts);
      rawDb
        .prepare("insert into tasks (id, company_id, title, description, assignee_agent_id, status, priority, active_run_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run("task-inflight", "company-1", "Running", "", "agent-cmo", "in_progress", "medium", "run-1", ts, ts);
    } finally {
      rawDb.close();
    }

    const appDb = new AppDatabase(profileDir);
    appDb.init();
    try {
      const rows = appDb
        .queryAll<{ id: string; requiresFilesystem: number }>("select id, requires_filesystem as requiresFilesystem from tasks order by id");
      expect(rows).toEqual([
        { id: "task-coding", requiresFilesystem: 1 },
        { id: "task-cognitive", requiresFilesystem: 0 },
        { id: "task-inflight", requiresFilesystem: 1 },
      ]);
      const migration = appDb.queryAll<{ version: number }>("select version from schema_migrations where version = 56")[0];
      expect(migration?.version).toBe(56);
    } finally {
      appDb.close();
    }
  });
});
