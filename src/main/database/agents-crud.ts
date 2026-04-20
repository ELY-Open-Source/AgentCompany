import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import log from "electron-log/main.js";
import type { AgentModelStrategy, AgentRecord, AgentRoleLevel, ConnectorId } from "@shared/types";
import {
  type ReadAll,
  type Transaction,
  ensureId,
  normalizeOptionalId,
  nowIso,
} from "./helpers";
export function buildAgentCrudMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
  deps: {
    getAgent: (id: string) => AgentRecord;
    wouldCreateAgentCycle: (agentId: string, reportsTo: string | null) => boolean;
    recordConfigRevision: (input: {
      companyId: string;
      agentId: string;
      changedKeys: string[];
      configBefore: Record<string, unknown>;
      configAfter: Record<string, unknown>;
      source?: string;
      rolledBackFromRevisionId?: string | null;
      createdByAgentId?: string | null;
      createdByUserId?: string | null;
    }) => string;
    cancelRunForDeletion: (runId: string, taskId: string | null, workspaceId: string | null, summary: string) => void;
    addActivity: (input: { companyId: string; actor: string; action: string; entityType: string; entityId: string; detail: string }) => void;
  },
) {
  return {
    saveAgent(input: {
      id?: string | null;
      companyId: string;
      name: string;
      role: string;
      title: string;
      department?: string | null;
      status: AgentRecord["status"];
      reportsTo?: string | null;
      connectorId: ConnectorId;
      workspaceId?: string | null;
      model?: string | null;
      metadataJson?: string;
      capabilities: string;
      budgetMonthlyUsd: number;
      /** Optional explicit seniority; inferred from role/title when omitted. */
      roleLevel?: AgentRoleLevel;
      /**
       * Model routing strategy (v39+). `explicit` pins the agent to
       * `connectorId + model`; `auto` lets the dispatcher pick at run
       * time. Omitting this leaves the existing column untouched on
       * update, and uses the DB default ('explicit') on insert.
       */
      modelStrategy?: AgentModelStrategy;
    }): string {
      const id = ensureId(input.id ?? null);
      const ts = nowIso();
      const metadataJson = input.metadataJson ?? "{}";
      const department = input.department ?? null;
      const reportsTo = normalizeOptionalId(input.reportsTo);
      if (deps.wouldCreateAgentCycle(id, reportsTo)) {
        throw new Error("Agent reporting relationship would create a cycle.");
      }
      const existing = getDb()
        .prepare("select id from agents where id = ? and company_id = ?")
        .get(id, input.companyId) as { id: string } | undefined;
      if (existing) {
        // Snapshot before-config for revision tracking
        const beforeAgent = getDb()
          .prepare(
            "SELECT name, role, title, department, capabilities, connector_id, model, model_strategy, role_level, budget_monthly_usd, metadata_json FROM agents WHERE id = ? AND company_id = ?",
          )
          .get(id, input.companyId) as Record<string, unknown> | undefined;
        // Preserve existing modelStrategy and roleLevel when the caller omits
        // them, so non-related updates (e.g. updateAgentWorkspaceBinding) do
        // not accidentally flip routing or seniority.
        const effectiveStrategy = input.modelStrategy ?? (beforeAgent?.model_strategy as string | undefined) ?? "explicit";
        const effectiveRoleLevel = input.roleLevel ?? (beforeAgent?.role_level as string | undefined) ?? "ic";
        getDb()
          .prepare(
            "update agents set name = ?, role = ?, title = ?, department = ?, status = ?, reports_to = ?, connector_id = ?, workspace_id = ?, model = ?, model_strategy = ?, role_level = ?, metadata_json = ?, capabilities = ?, budget_monthly_usd = ?, updated_at = ? where id = ? and company_id = ?",
          )
          .run(
            input.name,
            input.role,
            input.title,
            department,
            input.status,
            reportsTo,
            input.connectorId,
            normalizeOptionalId(input.workspaceId),
            normalizeOptionalId(input.model),
            effectiveStrategy,
            effectiveRoleLevel,
            metadataJson,
            input.capabilities,
            input.budgetMonthlyUsd,
            ts,
            id,
            input.companyId,
          );
        // Record config revision if fields changed
        if (beforeAgent) {
          const afterConfig = {
            name: input.name,
            role: input.role,
            title: input.title,
            department,
            capabilities: input.capabilities,
            connectorId: input.connectorId,
            model: normalizeOptionalId(input.model),
            budgetMonthlyUsd: input.budgetMonthlyUsd,
            metadataJson,
          };
          const beforeConfig = {
            name: beforeAgent.name,
            role: beforeAgent.role,
            title: beforeAgent.title,
            department: beforeAgent.department,
            capabilities: beforeAgent.capabilities,
            connectorId: beforeAgent.connector_id,
            model: beforeAgent.model,
            budgetMonthlyUsd: beforeAgent.budget_monthly_usd,
            metadataJson: beforeAgent.metadata_json,
          };
          const changedKeys = Object.keys(afterConfig).filter(
            (k) =>
              JSON.stringify((afterConfig as Record<string, unknown>)[k]) !==
              JSON.stringify((beforeConfig as Record<string, unknown>)[k]),
          );
          if (changedKeys.length > 0) {
            try {
              deps.recordConfigRevision({
                companyId: input.companyId,
                agentId: id,
                changedKeys,
                configBefore: beforeConfig,
                configAfter: afterConfig,
              });
            } catch (err) {
              log.warn(`[database/agents] recordConfigRevision failed for agent ${id}:`, err instanceof Error ? err.message : String(err));
            }
          }
        }
      } else {
        const insertStrategy = input.modelStrategy ?? "explicit";
        const insertRoleLevel = input.roleLevel ?? "ic";
        getDb()
          .prepare(
            "insert into agents (id, company_id, name, role, title, department, status, reports_to, connector_id, workspace_id, model, model_strategy, role_level, capabilities, budget_monthly_usd, spent_monthly_usd, metadata_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)",
          )
          .run(
            id,
            input.companyId,
            input.name,
            input.role,
            input.title,
            department,
            input.status,
            reportsTo,
            input.connectorId,
            normalizeOptionalId(input.workspaceId),
            normalizeOptionalId(input.model),
            insertStrategy,
            insertRoleLevel,
            input.capabilities,
            input.budgetMonthlyUsd,
            metadataJson,
            ts,
            ts,
          );
      }
      return id;
    },

    deleteAgent(id: string, companyId: string): void {
      const activeAgentRuns = readAll<{ id: string; taskId: string | null; workspaceId: string | null }>(
        "select id, task_id as taskId, workspace_id as workspaceId from runs where agent_id = ? and company_id = ? and status in ('queued', 'running')",
        id,
        companyId,
      );
      transaction(() => {
        for (const run of activeAgentRuns) {
          deps.cancelRunForDeletion(run.id, run.taskId, run.workspaceId, "Agent deleted.");
        }
        getDb()
          .prepare(
            "update tasks set assignee_agent_id = null where assignee_agent_id = ? and company_id = ?",
          )
          .run(id, companyId);
        getDb()
          .prepare(
            "update goals set owner_agent_id = null where owner_agent_id = ? and company_id = ?",
          )
          .run(id, companyId);
        getDb()
          .prepare(
            "update projects set lead_agent_id = null where lead_agent_id = ? and company_id = ?",
          )
          .run(id, companyId);
        getDb()
          .prepare("update agents set reports_to = null where reports_to = ? and company_id = ?")
          .run(id, companyId);
        // Clean up orphaned approvals referencing this agent
        getDb()
          .prepare(
            "update approvals set requested_by_agent_id = null where requested_by_agent_id = ? and company_id = ?",
          )
          .run(id, companyId);
        getDb()
          .prepare(
            "update approvals set related_agent_id = null where related_agent_id = ? and company_id = ?",
          )
          .run(id, companyId);
        // Clean up meetings organized by this agent
        getDb()
          .prepare(
            "update meetings set organizer_agent_id = null where organizer_agent_id = ? and company_id = ?",
          )
          .run(id, companyId);
        // Clean up documents authored/reviewed by this agent
        getDb()
          .prepare(
            "update documents set author_agent_id = null where author_agent_id = ? and company_id = ?",
          )
          .run(id, companyId);
        getDb()
          .prepare(
            "update documents set reviewer_agent_id = null where reviewer_agent_id = ? and company_id = ?",
          )
          .run(id, companyId);
        // Clean up knowledge entries authored by this agent
        getDb()
          .prepare(
            "update knowledge_base set author_agent_id = null where author_agent_id = ? and company_id = ?",
          )
          .run(id, companyId);
        // Remove wakeup requests for this agent
        getDb()
          .prepare("DELETE FROM wakeup_requests WHERE agent_id = ? AND company_id = ?")
          .run(id, companyId);
        getDb().prepare("delete from agents where id = ? and company_id = ?").run(id, companyId);
      });
    },

    updateAgentStatus(agentId: string, status: string): void {
      const ts = new Date().toISOString();
      getDb()
        .prepare("update agents set status = ?, updated_at = ? where id = ?")
        .run(status, ts, agentId);
    },

    hasAgentAssignedTasks(agentId: string, companyId: string): boolean {
      const row = getDb()
        .prepare(
          "select 1 from tasks where assignee_agent_id = ? and company_id = ? and status in ('todo', 'in_progress', 'blocked') limit 1",
        )
        .get(agentId, companyId);
      return !!row;
    },

    isAgentPendingApproval(agentId: string): boolean {
      const row = getDb()
        .prepare("select status from agents where id = ?")
        .get(agentId) as { status: string } | undefined;
      return row?.status === "pending_approval";
    },

    findMentionedAgentIds(companyId: string, text: string): string[] {
      if (!text.includes("@")) return [];
      const mentionTokens = new Set<string>();
      const mentionRegex = /@([\p{L}\p{N} _-]{1,80})(?=[\s,!?.;:\])}>]|$)/gu;
      for (const match of text.toLowerCase().matchAll(mentionRegex)) {
        const token = match[1]?.trim();
        if (token) mentionTokens.add(token);
      }
      if (mentionTokens.size === 0) return [];

      const patterns = Array.from(mentionTokens).flatMap((token) => {
        const words = token.split(/\s+/).filter(Boolean);
        return words.length > 1 ? [token, words[0]!] : [token];
      });
      const placeholders = patterns.map(() => "lower(name) = ? or lower(role) = ? or lower(title) = ?").join(" or ");
      const params: SQLInputValue[] = [companyId];
      for (const p of patterns) {
        params.push(p, p, p);
      }
      const agents = readAll<{ id: string; name: string; role: string; title: string }>(
        `SELECT id, name, role, title FROM agents WHERE company_id = ? AND (${placeholders})`,
        ...params,
      );
      if (agents.length === 0) return [];

      const lowerText = text.toLowerCase();
      // Per-alias agent set. Storing a `Set` (not an array) means the
      // same agent contributing the same string via multiple fields
      // (e.g. name === role === "CEO") collapses to one entry. Before
      // this fix the duplicate push made the alias look non-unique, the
      // unique-alias filter dropped it, and every @mention in a scaffold
      // where role mirrored name silently missed.
      const aliasMap = new Map<string, Set<string>>();
      const registerAlias = (alias: string, agentId: string) => {
        const normalized = alias.trim().toLowerCase();
        if (!normalized) return;
        const existing = aliasMap.get(normalized) ?? new Set<string>();
        existing.add(agentId);
        aliasMap.set(normalized, existing);
      };
      for (const agent of agents) {
        registerAlias(agent.name, agent.id);
        registerAlias(agent.role, agent.id);
        registerAlias(agent.title, agent.id);
      }

      const matched = new Set<string>();
      // Only aliases that unambiguously resolve to a single agent are
      // treated as mentions. Two agents sharing a role ("CEO" appearing
      // twice in the company) make `@ceo` ambiguous and we refuse to
      // pick one silently.
      const uniqueAliases = [...aliasMap.entries()]
        .filter(([, ids]) => ids.size === 1)
        .sort((a, b) => b[0].length - a[0].length);
      for (const [alias, ids] of uniqueAliases) {
        const pattern = `@${alias}`;
        const idx = lowerText.indexOf(pattern);
        if (idx === -1) continue;
        const afterIdx = idx + pattern.length;
        if (afterIdx >= lowerText.length || /[\s,!?.;:\])}>]/.test(lowerText[afterIdx]!)) {
          const [onlyId] = ids;
          if (onlyId) matched.add(onlyId);
        }
      }
      return [...matched];
    },

    countActiveRunsForAgent(agentId: string, companyId: string): number {
      const row = getDb()
        .prepare(
          "SELECT COUNT(*) as cnt FROM runs WHERE agent_id = ? AND company_id = ? AND status IN ('queued', 'running')",
        )
        .get(agentId, companyId) as { cnt: number } | undefined;
      return row?.cnt ?? 0;
    },
  };
}
