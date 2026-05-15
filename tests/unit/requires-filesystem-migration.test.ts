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
import { migrateFilesystemTaskWorkspacesV60 } from "../../src/main/database/migrations/v60-filesystem-task-workspaces";

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
      const migrations = appDb.queryAll<{ version: number; name: string }>(
        "select version, name from schema_migrations where version in (56, 57, 58, 59, 60) order by version",
      );
      expect(migrations).toEqual([
        { version: 56, name: "baseline_v56" },
        { version: 57, name: "task_leases_runtime_ownership" },
        { version: 58, name: "approval_policy_table" },
        { version: 59, name: "social_company_scope" },
        { version: 60, name: "filesystem_task_workspaces" },
      ]);
    } finally {
      appDb.close();
    }
  });

  it("backfills active filesystem tasks in single-workspace companies", async () => {
    const profileDir = await createTempDir("agentcompany-fs-workspace-v60-");
    const rawDb = new DatabaseSync(join(profileDir, "profile.sqlite"));
    const ts = "2026-05-15T00:00:00.000Z";
    try {
      rawDb.exec(`
        create table schema_migrations (version integer primary key, name text not null, applied_at text not null);
        create table workspaces (
          id text primary key,
          company_id text not null,
          project_id text,
          is_primary integer not null,
          created_at text not null
        );
        create table agents (
          id text primary key,
          company_id text not null,
          workspace_id text
        );
        create table tasks (
          id text primary key,
          company_id text not null,
          project_id text,
          assignee_agent_id text,
          workspace_id text,
          status text not null,
          requires_filesystem integer not null,
          updated_at text not null
        );
      `);
      rawDb
        .prepare("insert into workspaces (id, company_id, project_id, is_primary, created_at) values (?, ?, ?, ?, ?)")
        .run("workspace-1", "company-1", null, 1, ts);
      rawDb
        .prepare("insert into agents (id, company_id, workspace_id) values (?, ?, ?)")
        .run("agent-1", "company-1", null);
      rawDb
        .prepare("insert into tasks (id, company_id, project_id, assignee_agent_id, workspace_id, status, requires_filesystem, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("task-stuck", "company-1", "project-1", "agent-1", null, "todo", 1, ts);
      rawDb
        .prepare("insert into tasks (id, company_id, project_id, assignee_agent_id, workspace_id, status, requires_filesystem, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("task-cognitive", "company-1", "project-1", "agent-1", null, "todo", 0, ts);

      migrateFilesystemTaskWorkspacesV60(rawDb);

      const rows = rawDb
        .prepare("select id, workspace_id as workspaceId from tasks order by id")
        .all() as Array<{ id: string; workspaceId: string | null }>;
      expect(rows).toEqual([
        { id: "task-cognitive", workspaceId: null },
        { id: "task-stuck", workspaceId: "workspace-1" },
      ]);
    } finally {
      rawDb.close();
    }
  });
});
