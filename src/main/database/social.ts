import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { BrowserActionRecord, SocialAccountRecord } from "@shared/types";
import type { ReadAll, Transaction } from "./helpers";
import { ensureId, nowIso, toBoolean } from "./helpers";

type SqliteRow = Record<string, any>;

export function buildSocialMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
) {
  return {
    saveSocialAccount(input: {
      id?: string | null;
      companyId: string;
      platform: string;
      accountName: string;
      displayName?: string;
      profileUrl?: string;
      credentialSecretId?: string | null;
      status?: string;
      requireApproval?: boolean;
      metadataJson?: string;
    }): string {
      const id = ensureId(input.id);
      const now = nowIso();
      getDb().prepare(`INSERT INTO social_accounts (id, company_id, platform, account_name, display_name, profile_url, credential_secret_id, status, require_approval, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          platform = excluded.platform,
          account_name = excluded.account_name,
          display_name = excluded.display_name,
          profile_url = excluded.profile_url,
          credential_secret_id = excluded.credential_secret_id,
          status = excluded.status,
          require_approval = excluded.require_approval,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at`).run(
        id, input.companyId, input.platform, input.accountName,
        input.displayName ?? "", input.profileUrl ?? "",
        input.credentialSecretId ?? null, input.status ?? "login_required",
        input.requireApproval !== false ? 1 : 0,
        input.metadataJson ?? "{}", now, now,
      );
      return id;
    },

    deleteSocialAccount(id: string, companyId: string) {
      transaction(() => {
        getDb().prepare("DELETE FROM social_accounts WHERE id = ? AND company_id = ?").run(id, companyId);
        getDb().prepare("DELETE FROM browser_actions WHERE social_account_id = ? AND company_id = ?").run(id, companyId);
      });
    },

    listSocialAccounts(companyId: string): SocialAccountRecord[] {
      const rows = getDb().prepare("SELECT * FROM social_accounts WHERE company_id = ? ORDER BY created_at DESC").all(companyId) as SqliteRow[];
      return rows.map((r) => ({
        id: r.id, companyId: r.company_id, platform: r.platform,
        accountName: r.account_name, displayName: r.display_name,
        profileUrl: r.profile_url, credentialSecretId: r.credential_secret_id,
        status: r.status, requireApproval: toBoolean(r.require_approval),
        metadataJson: r.metadata_json, lastUsedAt: r.last_used_at,
        createdAt: r.created_at, updatedAt: r.updated_at,
      }));
    },

    getSocialAccount(id: string, companyId: string): SocialAccountRecord | null {
      const row = getDb()
        .prepare("SELECT * FROM social_accounts WHERE id = ? AND company_id = ?")
        .get(id, companyId) as SqliteRow | undefined;
      if (!row) return null;
      return {
        id: row.id, companyId: row.company_id, platform: row.platform,
        accountName: row.account_name, displayName: row.display_name,
        profileUrl: row.profile_url, credentialSecretId: row.credential_secret_id,
        status: row.status, requireApproval: toBoolean(row.require_approval),
        metadataJson: row.metadata_json, lastUsedAt: row.last_used_at,
        createdAt: row.created_at, updatedAt: row.updated_at,
      };
    },

    saveBrowserAction(input: {
      companyId: string;
      socialAccountId: string;
      agentId: string;
      taskId?: string | null;
      actionType: string;
      payloadJson: string;
      status?: string;
      approvalId?: string | null;
    }): string {
      const id = randomUUID();
      const now = nowIso();
      getDb().prepare(`INSERT INTO browser_actions (id, company_id, social_account_id, agent_id, task_id, action_type, payload_json, status, approval_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, input.companyId, input.socialAccountId, input.agentId,
        input.taskId ?? null, input.actionType, input.payloadJson,
        input.status ?? "queued", input.approvalId ?? null, now, now,
      );
      return id;
    },

    updateBrowserAction(id: string, updates: { status?: string; resultSummary?: string; screenshotPath?: string | null; errorMessage?: string | null; startedAt?: string; finishedAt?: string }) {
      const now = nowIso();
      const sets: string[] = ["updated_at = ?"];
      const values: SQLInputValue[] = [now];
      if (updates.status) { sets.push("status = ?"); values.push(updates.status); }
      if (updates.resultSummary !== undefined) { sets.push("result_summary = ?"); values.push(updates.resultSummary); }
      if (updates.screenshotPath !== undefined) { sets.push("screenshot_path = ?"); values.push(updates.screenshotPath); }
      if (updates.errorMessage !== undefined) { sets.push("error_message = ?"); values.push(updates.errorMessage); }
      if (updates.startedAt) { sets.push("started_at = ?"); values.push(updates.startedAt); }
      if (updates.finishedAt) { sets.push("finished_at = ?"); values.push(updates.finishedAt); }
      values.push(id);
      getDb().prepare(`UPDATE browser_actions SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    },

    listBrowserActions(companyId: string, filters?: { socialAccountId?: string; status?: string; limit?: number }): BrowserActionRecord[] {
      let sql = "SELECT * FROM browser_actions WHERE company_id = ?";
      const params: SQLInputValue[] = [companyId];
      if (filters?.socialAccountId) { sql += " AND social_account_id = ?"; params.push(filters.socialAccountId); }
      if (filters?.status) {
        const statuses = filters.status.split(",").filter(Boolean);
        if (statuses.length > 0) {
          sql += ` AND status IN (${statuses.map(() => "?").join(",")})`;
          params.push(...statuses);
        }
      }
      sql += " ORDER BY created_at DESC";
      if (filters?.limit) { sql += " LIMIT ?"; params.push(filters.limit); }

      const rows = getDb().prepare(sql).all(...params) as SqliteRow[];
      return rows.map((r) => ({
        id: r.id, companyId: r.company_id, socialAccountId: r.social_account_id,
        agentId: r.agent_id, taskId: r.task_id, status: r.status,
        actionType: r.action_type, payloadJson: r.payload_json,
        resultSummary: r.result_summary, screenshotPath: r.screenshot_path,
        approvalId: r.approval_id, errorMessage: r.error_message,
        startedAt: r.started_at, finishedAt: r.finished_at,
        createdAt: r.created_at, updatedAt: r.updated_at,
      }));
    },

    getBrowserAction(id: string, companyId: string): BrowserActionRecord | null {
      const row = getDb()
        .prepare("SELECT * FROM browser_actions WHERE id = ? AND company_id = ?")
        .get(id, companyId) as SqliteRow | undefined;
      if (!row) return null;
      return {
        id: row.id, companyId: row.company_id, socialAccountId: row.social_account_id,
        agentId: row.agent_id, taskId: row.task_id, status: row.status,
        actionType: row.action_type, payloadJson: row.payload_json,
        resultSummary: row.result_summary, screenshotPath: row.screenshot_path,
        approvalId: row.approval_id, errorMessage: row.error_message,
        startedAt: row.started_at, finishedAt: row.finished_at,
        createdAt: row.created_at, updatedAt: row.updated_at,
      };
    },

    getBrowserActionByApprovalId(approvalId: string, companyId: string): BrowserActionRecord | null {
      const row = getDb()
        .prepare("SELECT * FROM browser_actions WHERE approval_id = ? AND company_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(approvalId, companyId) as SqliteRow | undefined;
      if (!row) return null;
      return {
        id: row.id, companyId: row.company_id, socialAccountId: row.social_account_id,
        agentId: row.agent_id, taskId: row.task_id, status: row.status,
        actionType: row.action_type, payloadJson: row.payload_json,
        resultSummary: row.result_summary, screenshotPath: row.screenshot_path,
        approvalId: row.approval_id, errorMessage: row.error_message,
        startedAt: row.started_at, finishedAt: row.finished_at,
        createdAt: row.created_at, updatedAt: row.updated_at,
      };
    },
  };
}
