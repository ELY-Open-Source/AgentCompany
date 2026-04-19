import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ProfileSnapshot } from "@shared/types";
import {
  type ReadAll,
  type Transaction,
  nowIso,
} from "./helpers";

export function buildCompanyCrudMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
  deps: {
    getSetting: (key: string) => string | null;
    setSetting: (key: string, value: string) => void;
    listSnapshot: (options: { companyId?: string | null }) => ProfileSnapshot;
    addComment: (input: { companyId: string; taskId: string; authorAgentId: string | null; authorName: string; body: string }) => void;
  },
) {
  return {
    saveCompany(input: {
      id?: string | null;
      name: string;
      description: string;
      status: string;
      autoApproveHires?: boolean;
      reviewDeliverables?: boolean;
      executionMode?: string;
    }): string {
      const id = input.id && input.id.length > 0 ? input.id : randomUUID();
      const ts = nowIso();
      const autoApprove = input.autoApproveHires ? 1 : 0;
      const reviewDeliverables = input.reviewDeliverables ? 1 : 0;
      const executionMode = input.executionMode ?? "ai_ceo";
      const existing = getDb()
        .prepare("select id from companies where id = ?")
        .get(id) as { id: string } | undefined;
      if (existing) {
        getDb()
          .prepare(
            "update companies set name = ?, description = ?, status = ?, auto_approve_hires = ?, review_deliverables = ?, execution_mode = ?, updated_at = ? where id = ?",
          )
          .run(input.name, input.description, input.status, autoApprove, reviewDeliverables, executionMode, ts, id);
      } else {
        getDb()
          .prepare(
            "insert into companies (id, name, description, status, auto_approve_hires, review_deliverables, execution_mode, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(id, input.name, input.description, input.status, autoApprove, reviewDeliverables, executionMode, ts, ts);
        if (!deps.getSetting("current_company_id")) {
          deps.setSetting("current_company_id", id);
        }
      }
      return id;
    },

    deleteCompany(companyId: string): void {
      transaction(() => {
        try {
          getDb()
            .prepare(
              "delete from agent_message_reads where message_id in (select id from agent_messages where company_id = ?)",
            )
            .run(companyId);
        } catch (err) {
          if (!(err instanceof Error) || !err.message.includes("no such table")) throw err;
        }
        // New table cleanup (budget_incidents before budget_policies due to FK)
        getDb().prepare("delete from budget_incidents where company_id = ?").run(companyId);
        getDb().prepare("delete from budget_policies where company_id = ?").run(companyId);
        // agent_skill_assignments references company_skills -- delete before skills
        try {
          getDb()
            .prepare(
              "delete from agent_skill_assignments where skill_id in (select id from company_skills where company_id = ?)",
            )
            .run(companyId);
        } catch (err) {
          if (!(err instanceof Error) || !err.message.includes("no such table")) throw err;
        }
        getDb().prepare("delete from company_skills where company_id = ?").run(companyId);
        getDb().prepare("delete from task_sessions where company_id = ?").run(companyId);
        getDb().prepare("delete from wakeup_requests where company_id = ?").run(companyId);
        // Thread runtime tables (events + participants cascade from threads via FK)
        getDb().prepare("delete from thread_wait_states where company_id = ?").run(companyId);
        getDb().prepare("delete from conversation_threads where company_id = ?").run(companyId);
        getDb().prepare("delete from cost_entries where company_id = ?").run(companyId);
        getDb().prepare("delete from activity where company_id = ?").run(companyId);
        getDb().prepare("delete from task_comments where company_id = ?").run(companyId);
        getDb().prepare("delete from runs where company_id = ?").run(companyId);
        getDb().prepare("delete from approvals where company_id = ?").run(companyId);
        getDb().prepare("delete from tasks where company_id = ?").run(companyId);
        getDb().prepare("delete from projects where company_id = ?").run(companyId);
        getDb().prepare("delete from goals where company_id = ?").run(companyId);
        getDb().prepare("delete from agents where company_id = ?").run(companyId);
        getDb().prepare("delete from secrets where company_id = ?").run(companyId);
        getDb().prepare("delete from workspaces where company_id = ?").run(companyId);
        for (const table of [
          "automation_rules",
          "automation_log",
          "agent_messages",
          "workflow_pipelines",
          "meetings",
          "documents",
          "knowledge_base",
          "sprints",
          "browser_actions",
          "social_accounts",
        ]) {
          try {
            getDb().prepare(`delete from ${table} where company_id = ?`).run(companyId);
          } catch (err) {
            // Only tolerate "no such table" — re-throw anything else (disk error, etc.)
            if (!(err instanceof Error) || !err.message.includes("no such table")) throw err;
          }
        }
        getDb().prepare("delete from companies where id = ?").run(companyId);
        if (deps.getSetting("current_company_id") === companyId) {
          const next = getDb()
            .prepare("select id from companies order by created_at asc limit 1")
            .get() as { id: string } | undefined;
          if (next) {
            deps.setSetting("current_company_id", next.id);
          } else {
            deps.setSetting("current_company_id", "");
          }
        }
      });
    },

    getCompanyStatus(companyId: string): string | null {
      const row = getDb()
        .prepare("select status from companies where id = ?")
        .get(companyId) as { status: string } | undefined;
      return row?.status ?? null;
    },

    getCompanyBasic(companyId: string): { name: string; description: string } | null {
      const row = getDb()
        .prepare("select name, description from companies where id = ?")
        .get(companyId) as { name: string; description: string } | undefined;
      return row ?? null;
    },

    listActiveCompanyIds(): Array<{ id: string; name: string }> {
      return readAll<{ id: string; name: string }>(
        "select id, name from companies where status = 'active'",
      );
    },

    getCompanyExecutionMode(companyId: string): string {
      const row = getDb()
        .prepare("SELECT execution_mode FROM companies WHERE id = ? LIMIT 1")
        .get(companyId) as { execution_mode: string } | undefined;
      return row?.execution_mode ?? "ai_ceo";
    },

    getCompanyApprovalSettings(companyId: string): { autoApproveHires: boolean; reviewDeliverables: boolean } | null {
      const row = getDb()
        .prepare("SELECT auto_approve_hires, review_deliverables FROM companies WHERE id = ? LIMIT 1")
        .get(companyId) as { auto_approve_hires: number; review_deliverables: number } | undefined;
      if (!row) return null;
      return {
        autoApproveHires: row.auto_approve_hires === 1,
        reviewDeliverables: row.review_deliverables === 1,
      };
    },
  };
}
