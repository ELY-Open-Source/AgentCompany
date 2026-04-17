import { randomUUID } from "node:crypto";
import log from "electron-log/main.js";
import type { Migration, MigrationDeps } from "./types";
import { columnExists, nowIso } from "./types";

export function createMigrationsV16V25(deps: MigrationDeps): Migration[] {
  const { db, readAll } = deps;
  return [
    { version: 16, name: "create_agent_skill_assignments", sql: `CREATE TABLE IF NOT EXISTS agent_skill_assignments (agent_id TEXT NOT NULL, skill_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (agent_id, skill_id), FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE, FOREIGN KEY (skill_id) REFERENCES company_skills(id) ON DELETE CASCADE); CREATE INDEX IF NOT EXISTS idx_agent_skill_assignments_skill ON agent_skill_assignments(skill_id)` },
    {
      version: 17, name: "migrate_pending_wakes_to_wakeup_requests",
      fn: () => {
        const existingWakes = readAll<{ id: string; companyId: string; agentId: string; triggerReason: string; createdAt: string }>(
          `SELECT id, company_id AS companyId, agent_id AS agentId, trigger_reason AS triggerReason, created_at AS createdAt FROM pending_wakes`,
        );
        const ts = nowIso();
        for (const wake of existingWakes) {
          const triggerDetail = JSON.stringify([{ trigger: wake.triggerReason, at: wake.createdAt, detail: wake.triggerReason }]);
          db.prepare(`INSERT OR IGNORE INTO wakeup_requests (id, company_id, agent_id, source, trigger_detail, status, coalesced_count, requested_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)`).run(wake.id, wake.companyId, wake.agentId, wake.triggerReason, triggerDetail, wake.createdAt, ts, ts);
        }
        db.exec("DROP TABLE IF EXISTS pending_wakes");
      },
    },
    {
      version: 18, name: "migrate_agent_budget_to_policies",
      fn: () => {
        const agents = readAll<{ id: string; companyId: string; budgetMonthlyUsd: number }>("SELECT id, company_id as companyId, budget_monthly_usd as budgetMonthlyUsd FROM agents WHERE budget_monthly_usd > 0");
        const ts = nowIso();
        for (const agent of agents) {
          const existing = db.prepare("SELECT id FROM budget_policies WHERE company_id = ? AND scope_type = 'agent' AND scope_id = ? AND metric = 'billed_cents' AND window_kind = 'calendar_month_utc'").get(agent.companyId, agent.id);
          if (!existing) {
            db.prepare("INSERT INTO budget_policies (id, company_id, scope_type, scope_id, metric, window_kind, amount, warn_percent, hard_stop_enabled, notify_enabled, is_active, created_at, updated_at) VALUES (?, ?, 'agent', ?, 'billed_cents', 'calendar_month_utc', ?, 80, 1, 1, 1, ?, ?)").run(randomUUID(), agent.companyId, agent.id, Math.round(agent.budgetMonthlyUsd * 100), ts, ts);
          }
        }
        log.info(`Budget migration: converted ${agents.length} agent budget(s) to policy rows`);
      },
    },
    {
      version: 19, name: "add_document_revisions_and_approval_comments",
      fn: () => {
        db.exec(`CREATE TABLE IF NOT EXISTS document_revisions (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, document_id TEXT NOT NULL, revision_number INTEGER NOT NULL, body TEXT NOT NULL, change_summary TEXT, created_by_agent_id TEXT, created_by_user_id TEXT, created_at TEXT NOT NULL, FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE); CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_rev_doc_num ON document_revisions(document_id, revision_number); CREATE INDEX IF NOT EXISTS idx_doc_rev_company ON document_revisions(company_id, document_id, created_at); CREATE TABLE IF NOT EXISTS approval_comments (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, approval_id TEXT NOT NULL, author_agent_id TEXT, author_user_id TEXT, body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (approval_id) REFERENCES approvals(id) ON DELETE CASCADE); CREATE INDEX IF NOT EXISTS idx_approval_comments_approval ON approval_comments(approval_id, created_at)`);
        if (!columnExists(db, "documents", "latest_revision_id")) {
          db.prepare("ALTER TABLE documents ADD COLUMN latest_revision_id TEXT").run();
        }
      },
    },
    {
      version: 20, name: "add_task_timestamps_and_task_approval_links",
      fn: () => {
        const addCol = (table: string, column: string, sql: string) => {
          if (!columnExists(db, table, column)) db.prepare(sql).run();
        };
        addCol("tasks", "started_at", "ALTER TABLE tasks ADD COLUMN started_at TEXT");
        addCol("tasks", "completed_at", "ALTER TABLE tasks ADD COLUMN completed_at TEXT");
        addCol("tasks", "cancelled_at", "ALTER TABLE tasks ADD COLUMN cancelled_at TEXT");
        db.exec(`CREATE TABLE IF NOT EXISTS task_approval_links (task_id TEXT NOT NULL, approval_id TEXT NOT NULL, company_id TEXT NOT NULL, linked_by_agent_id TEXT, created_at TEXT NOT NULL, PRIMARY KEY (task_id, approval_id), FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (approval_id) REFERENCES approvals(id) ON DELETE CASCADE); CREATE INDEX IF NOT EXISTS idx_task_approval_links_task ON task_approval_links(task_id); CREATE INDEX IF NOT EXISTS idx_task_approval_links_approval ON task_approval_links(approval_id)`);
        db.prepare("UPDATE tasks SET started_at = updated_at WHERE started_at IS NULL AND status IN ('in_progress', 'in_review', 'done')").run();
        db.prepare("UPDATE tasks SET completed_at = updated_at WHERE completed_at IS NULL AND status = 'done'").run();
        db.prepare("UPDATE tasks SET cancelled_at = updated_at WHERE cancelled_at IS NULL AND status = 'cancelled'").run();
      },
    },
    {
      version: 21, name: "add_work_products_task_documents_wakeup_context",
      fn: () => {
        db.exec(`CREATE TABLE IF NOT EXISTS work_products (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, project_id TEXT, task_id TEXT NOT NULL, type TEXT NOT NULL, provider TEXT NOT NULL, external_id TEXT, title TEXT NOT NULL, url TEXT, status TEXT NOT NULL DEFAULT 'active', review_state TEXT NOT NULL DEFAULT 'none', is_primary INTEGER NOT NULL DEFAULT 0, summary TEXT, metadata_json TEXT, created_by_run_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE); CREATE INDEX IF NOT EXISTS idx_work_products_task ON work_products(company_id, task_id, type); CREATE INDEX IF NOT EXISTS idx_work_products_updated ON work_products(company_id, updated_at); CREATE TABLE IF NOT EXISTS task_documents (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, task_id TEXT NOT NULL, document_id TEXT NOT NULL, key TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE); CREATE UNIQUE INDEX IF NOT EXISTS idx_task_documents_task_key ON task_documents(company_id, task_id, key); CREATE UNIQUE INDEX IF NOT EXISTS idx_task_documents_doc ON task_documents(document_id)`);
        if (!columnExists(db, "wakeup_requests", "context_snapshot")) {
          db.prepare("ALTER TABLE wakeup_requests ADD COLUMN context_snapshot TEXT").run();
        }
      },
    },
    {
      version: 22, name: "add_config_revisions_run_events_agent_permissions",
      fn: () => {
        db.exec(`CREATE TABLE IF NOT EXISTS agent_config_revisions (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, agent_id TEXT NOT NULL, revision_number INTEGER NOT NULL, changed_keys TEXT NOT NULL DEFAULT '[]', config_before TEXT NOT NULL, config_after TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'patch', rolled_back_from_revision_id TEXT, created_by_agent_id TEXT, created_by_user_id TEXT, created_at TEXT NOT NULL, FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE); CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_config_rev_num ON agent_config_revisions(agent_id, revision_number); CREATE INDEX IF NOT EXISTS idx_agent_config_rev_agent ON agent_config_revisions(company_id, agent_id, created_at); CREATE TABLE IF NOT EXISTS run_events (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id TEXT NOT NULL, run_id TEXT NOT NULL, agent_id TEXT NOT NULL, seq INTEGER NOT NULL, event_type TEXT NOT NULL, stream TEXT, level TEXT, message TEXT, payload TEXT, created_at TEXT NOT NULL, FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE); CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, seq); CREATE INDEX IF NOT EXISTS idx_run_events_company ON run_events(company_id, run_id)`);
        const addCol = (table: string, column: string, sql: string) => {
          if (!columnExists(db, table, column)) db.prepare(sql).run();
        };
        addCol("agents", "permissions_json", "ALTER TABLE agents ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '{}'");
        addCol("agents", "heartbeat_policy_json", "ALTER TABLE agents ADD COLUMN heartbeat_policy_json TEXT");
        addCol("agents", "runtime_state_json", "ALTER TABLE agents ADD COLUMN runtime_state_json TEXT");
        addCol("runs", "context_snapshot_json", "ALTER TABLE runs ADD COLUMN context_snapshot_json TEXT");
        addCol("runs", "actor_type", "ALTER TABLE runs ADD COLUMN actor_type TEXT");
        addCol("runs", "actor_id", "ALTER TABLE runs ADD COLUMN actor_id TEXT");
      },
    },
    {
      version: 23, name: "create_thread_runtime_tables",
      fn: () => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS conversation_threads (
            id TEXT PRIMARY KEY,
            company_id TEXT NOT NULL,
            title TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'task',
            related_entity_type TEXT,
            related_entity_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_conv_threads_company ON conversation_threads(company_id);
          CREATE INDEX IF NOT EXISTS idx_conv_threads_entity ON conversation_threads(related_entity_type, related_entity_id);

          CREATE TABLE IF NOT EXISTS conversation_events (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
            actor_id TEXT NOT NULL,
            actor_type TEXT NOT NULL,
            event_type TEXT NOT NULL,
            body TEXT NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_conv_events_thread ON conversation_events(thread_id, created_at);

          CREATE TABLE IF NOT EXISTS thread_wait_states (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
            company_id TEXT NOT NULL,
            waiting_for TEXT NOT NULL,
            related_approval_id TEXT,
            reason TEXT NOT NULL,
            created_at TEXT NOT NULL,
            resolved_at TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_thread_wait_company ON thread_wait_states(company_id, resolved_at);
          CREATE INDEX IF NOT EXISTS idx_thread_wait_thread ON thread_wait_states(thread_id);

          CREATE TABLE IF NOT EXISTS conversation_participants (
            thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
            participant_id TEXT NOT NULL,
            participant_type TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            joined_at TEXT NOT NULL,
            PRIMARY KEY (thread_id, participant_id)
          );
          CREATE INDEX IF NOT EXISTS idx_conv_participants_participant ON conversation_participants(participant_id);
        `);
      },
    },
    {
      version: 24, name: "create_thread_subscriptions",
      sql: `CREATE TABLE IF NOT EXISTS thread_subscriptions (
    thread_id TEXT NOT NULL REFERENCES conversation_threads(id) ON DELETE CASCADE,
    subscriber_id TEXT NOT NULL,
    subscriber_type TEXT NOT NULL,
    notify_on TEXT NOT NULL DEFAULT 'all',
    subscribed_at TEXT NOT NULL,
    PRIMARY KEY (thread_id, subscriber_id)
  );
  CREATE INDEX IF NOT EXISTS idx_thread_subs_subscriber ON thread_subscriptions(subscriber_id)`,
    },
    {
      version: 25, name: "add_sender_kind_to_messages",
      sql: `ALTER TABLE agent_messages ADD COLUMN sender_kind TEXT NOT NULL DEFAULT 'agent'`,
    },
  ];
}
