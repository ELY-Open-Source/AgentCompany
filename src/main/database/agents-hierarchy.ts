import type { DatabaseSync } from "node:sqlite";
import type { AgentRecord } from "@shared/types";
import {
  type ReadAll,
  type Transaction,
  nowIso,
  toBoolean,
} from "./helpers";

/**
 * Agent row shape returned by listAgentsForApi. Mirrors the historical
 * inline SQL projection in routes-agents.ts so HTTP response bodies
 * stay byte-stable. heartbeatEnabled is exposed as a boolean.
 */
export type AgentApiRow = {
  id: string;
  companyId: string;
  name: string;
  role: string;
  title: string | null;
  department: string | null;
  status: string;
  reportsTo: string | null;
  connectorId: string;
  workspaceId: string | null;
  model: string | null;
  capabilities: string | null;
  budgetMonthlyUsd: number | null;
  spentMonthlyUsd: number | null;
  metadataJson: string;
  heartbeatEnabled: boolean;
  heartbeatIntervalSec: number | null;
  lastHeartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Slim agent projection used by the me/standup aggregation.
 */
export type AgentStandupRow = {
  id: string;
  companyId: string;
  name: string;
  role: string;
  status: string;
  reportsTo: string | null;
  department: string | null;
};

export function buildAgentHierarchyMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  _transaction: Transaction,
  _deps: {
    getAgent: (id: string) => AgentRecord;
  },
) {
  return {
    getChainOfCommand(agentId: string): AgentRecord[] {
      const rows = readAll<AgentRecord & { depth: number }>(
        `WITH RECURSIVE chain AS (
           SELECT id, company_id as companyId, name, role, title, department, status,
                  reports_to as reportsTo, connector_id as connectorId, workspace_id as workspaceId,
                  model, capabilities, role_level as roleLevel, model_strategy as modelStrategy, budget_monthly_usd as budgetMonthlyUsd,
                  spent_monthly_usd as spentMonthlyUsd, metadata_json as metadataJson,
                  heartbeat_enabled as heartbeatEnabled, heartbeat_interval_sec as heartbeatIntervalSec,
                  last_heartbeat_at as lastHeartbeatAt, session_id as sessionId, created_at as createdAt, updated_at as updatedAt,
                  0 as depth
           FROM agents WHERE id = ?
           UNION ALL
           SELECT a.id, a.company_id, a.name, a.role, a.title, a.department, a.status,
                  a.reports_to, a.connector_id, a.workspace_id,
                  a.model, a.capabilities, a.role_level, a.model_strategy, a.budget_monthly_usd,
                  a.spent_monthly_usd, a.metadata_json,
                  a.heartbeat_enabled, a.heartbeat_interval_sec,
                  a.last_heartbeat_at, a.session_id, a.created_at, a.updated_at,
                  c.depth + 1
           FROM agents a JOIN chain c ON a.id = c.reportsTo
           WHERE c.depth < 20
         )
         SELECT * FROM chain ORDER BY depth`,
        agentId,
      );
      // Skip self (depth 0); return ancestors from direct manager upward.
      return rows.slice(1).map((record) => ({
        ...record,
        heartbeatEnabled: toBoolean(record.heartbeatEnabled),
      })) as AgentRecord[];
    },

    getDirectReports(agentId: string, companyId: string): AgentRecord[] {
      return readAll<AgentRecord>(
        "select id, company_id as companyId, name, role, title, department, status, reports_to as reportsTo, connector_id as connectorId, workspace_id as workspaceId, model, capabilities, role_level as roleLevel, model_strategy as modelStrategy, budget_monthly_usd as budgetMonthlyUsd, spent_monthly_usd as spentMonthlyUsd, metadata_json as metadataJson, heartbeat_enabled as heartbeatEnabled, heartbeat_interval_sec as heartbeatIntervalSec, last_heartbeat_at as lastHeartbeatAt, session_id as sessionId, created_at as createdAt, updated_at as updatedAt from agents where company_id = ? and reports_to = ?",
        companyId,
        agentId,
      ).map((record) => ({
        ...record,
        heartbeatEnabled: toBoolean(record.heartbeatEnabled),
      })) as AgentRecord[];
    },

    setHeartbeat(agentId: string, enabled: boolean, intervalSec: number): void {
      getDb()
        .prepare(
          "update agents set heartbeat_enabled = ?, heartbeat_interval_sec = ?, updated_at = ? where id = ?",
        )
        .run(enabled ? 1 : 0, intervalSec, nowIso(), agentId);
    },

    markHeartbeatAt(agentId: string): void {
      getDb()
        .prepare("update agents set last_heartbeat_at = ? where id = ?")
        .run(nowIso(), agentId);
    },

    /**
     * Returns all agents for a company with the full API projection used
     * by GET /api/companies/:companyId/agents. Mirrors the historical
     * inline SQL and maps heartbeat_enabled into a boolean.
     */
    listAgentsForApi(companyId: string): AgentApiRow[] {
      return readAll<AgentApiRow & { heartbeatEnabled: number | boolean }>(
        "select id, company_id as companyId, name, role, title, department, status, reports_to as reportsTo, connector_id as connectorId, workspace_id as workspaceId, model, capabilities, role_level as roleLevel, model_strategy as modelStrategy, budget_monthly_usd as budgetMonthlyUsd, spent_monthly_usd as spentMonthlyUsd, metadata_json as metadataJson, heartbeat_enabled as heartbeatEnabled, heartbeat_interval_sec as heartbeatIntervalSec, last_heartbeat_at as lastHeartbeatAt, created_at as createdAt, updated_at as updatedAt from agents where company_id = ? order by created_at asc",
        companyId,
      ).map((a) => ({ ...a, heartbeatEnabled: Boolean(a.heartbeatEnabled) })) as AgentApiRow[];
    },

    /**
     * Returns the slim standup projection used by
     * GET /api/agents/me/standup — only the fields that feed the
     * aggregation (id, name, role, status, reportsTo, department).
     */
    listAgentsForStandup(companyId: string): AgentStandupRow[] {
      return readAll<AgentStandupRow>(
        "select id, company_id as companyId, name, role, status, reports_to as reportsTo, department from agents where company_id = ? order by created_at asc",
        companyId,
      );
    },

    /**
     * Returns the slim direct-reports projection used by
     * GET /api/agents/me/standup — only (id, name, role, status).
     */
    listDirectReportsForStandup(
      companyId: string,
      managerId: string,
    ): Array<{ id: string; name: string; role: string; status: string }> {
      return readAll(
        "select id, name, role, status from agents where company_id = ? and reports_to = ? order by created_at asc",
        companyId,
        managerId,
      );
    },

    /**
     * Returns per-report task-status counts for the standup aggregation.
     * Joins agents with their tasks and aggregates statuses (in_progress,
     * in_review, blocked, done).
     */
    listReportStatusesForStandup(companyId: string, managerId: string): Array<{
      id: string;
      name: string;
      role: string;
      status: string;
      tasksInProgress: number;
      tasksInReview: number;
      tasksBlocked: number;
      tasksDone: number;
    }> {
      return readAll(
        `select agents.id as id, agents.name as name, agents.role as role, agents.status as status,
                coalesce(sum(case when tasks.status = 'in_progress' then 1 else 0 end), 0) as tasksInProgress,
                coalesce(sum(case when tasks.status = 'in_review' then 1 else 0 end), 0) as tasksInReview,
                coalesce(sum(case when tasks.status = 'blocked' then 1 else 0 end), 0) as tasksBlocked,
                coalesce(sum(case when tasks.status = 'done' then 1 else 0 end), 0) as tasksDone
           from agents
           left join tasks on tasks.assignee_agent_id = agents.id and tasks.company_id = agents.company_id
          where agents.company_id = ? and agents.reports_to = ?
          group by agents.id, agents.name, agents.role, agents.status
          order by agents.created_at asc`,
        companyId,
        managerId,
      );
    },

    /**
     * Returns the duplicate-detection projection used by
     * POST /api/companies/:id/agents to reject hires with a name that
     * already belongs to a non-terminated agent.
     */
    listExistingAgentsForHireCheck(
      companyId: string,
    ): Array<{ id: string; name: string; role: string }> {
      return readAll<{ id: string; name: string; role: string }>(
        "select id, name, role from agents where company_id = ? and status != 'terminated'",
        companyId,
      );
    },

    listHeartbeatEligibleAgents(companyId: string): AgentRecord[] {
      return readAll<AgentRecord>(
        "select id, company_id as companyId, name, role, title, department, status, reports_to as reportsTo, connector_id as connectorId, workspace_id as workspaceId, model, capabilities, role_level as roleLevel, model_strategy as modelStrategy, budget_monthly_usd as budgetMonthlyUsd, spent_monthly_usd as spentMonthlyUsd, metadata_json as metadataJson, heartbeat_enabled as heartbeatEnabled, heartbeat_interval_sec as heartbeatIntervalSec, last_heartbeat_at as lastHeartbeatAt, session_id as sessionId, created_at as createdAt, updated_at as updatedAt from agents where company_id = ? and heartbeat_enabled = 1 and status not in ('terminated', 'paused', 'error', 'pending_approval')",
        companyId,
      ).map((record) => ({
        ...record,
        heartbeatEnabled: toBoolean(record.heartbeatEnabled),
      })) as AgentRecord[];
    },

    getCeoForCompany(
      companyId: string,
    ): { id: string; name: string; lastHeartbeatAt: string | null } | null {
      const row = getDb()
        .prepare(
          "select id, name, last_heartbeat_at as lastHeartbeatAt from agents where company_id = ? and reports_to is null and status != 'terminated' limit 1",
        )
        .get(companyId) as
        | { id: string; name: string; lastHeartbeatAt: string | null }
        | undefined;
      return row ?? null;
    },

    listActiveAgentsForCompany(
      companyId: string,
    ): Array<{
      id: string;
      name: string;
      department: string | null;
      lastHeartbeatAt: string | null;
    }> {
      return readAll<{
        id: string;
        name: string;
        department: string | null;
        lastHeartbeatAt: string | null;
      }>(
        "select id, name, department, last_heartbeat_at as lastHeartbeatAt from agents where company_id = ? and status not in ('terminated', 'paused', 'pending_approval')",
        companyId,
      );
    },

    getIdleAgentsForDepartment(
      companyId: string,
      department: string,
    ): Array<{ id: string; name: string }> {
      return readAll(
        "select id, name from agents where company_id = ? and department = ? and status in ('idle', 'active') order by spent_monthly_usd asc",
        companyId,
        department,
      );
    },

    getManagerForAgent(
      agentId: string,
    ): { id: string; name: string; companyId: string } | null {
      const agent = getDb()
        .prepare("select reports_to, company_id from agents where id = ?")
        .get(agentId) as { reports_to: string | null; company_id: string } | undefined;
      if (!agent || !agent.reports_to) return null;
      const manager = getDb()
        .prepare("select id, name from agents where id = ?")
        .get(agent.reports_to) as { id: string; name: string } | undefined;
      return manager ? { ...manager, companyId: agent.company_id } : null;
    },

    resetMonthlyBudgets(companyId: string): void {
      getDb()
        .prepare(
          "update agents set spent_monthly_usd = 0, updated_at = ? where company_id = ? and spent_monthly_usd > 0",
        )
        .run(nowIso(), companyId);
    },

    /**
     * Returns ids of non-terminated agents in a department. Used by
     * `resolveMessageWakeTargets` to fan out "department" channel messages.
     */
    listDepartmentAgentIds(companyId: string, department: string): string[] {
      return readAll<{ id: string }>(
        "select id from agents where company_id = ? and department = ? and status != 'terminated'",
        companyId,
        department,
      ).map((row) => row.id);
    },

    /**
     * Returns ids of non-terminated agents that have no manager (top of the
     * reporting tree). Used by `resolveMessageWakeTargets` for "company"
     * channel broadcast.
     */
    listTopLevelAgentIds(companyId: string): string[] {
      return readAll<{ id: string }>(
        "select id from agents where company_id = ? and reports_to is null and status != 'terminated'",
        companyId,
      ).map((row) => row.id);
    },

    /**
     * Returns ids of agents that can receive incident pings: everybody not
     * terminated or still pending approval.
     */
    listIncidentPingableAgentIds(companyId: string): string[] {
      return readAll<{ id: string }>(
        "select id from agents where company_id = ? and status not in ('terminated', 'pending_approval')",
        companyId,
      ).map((row) => row.id);
    },

    /**
     * Returns the agent's display name, or null if the agent no longer
     * exists. Used for notification subject lines.
     */
    findAgentName(agentId: string): string | null {
      const row = getDb()
        .prepare("select name from agents where id = ? limit 1")
        .get(agentId) as { name: string } | undefined;
      return row?.name ?? null;
    },

    /**
     * Returns (id, name) pairs for the given ids, scoped to company. Used
     * for batched name resolution when fanning out message wake targets.
     */
    listAgentNamesByIds(companyId: string, agentIds: readonly string[]): Array<{ id: string; name: string }> {
      if (agentIds.length === 0) return [];
      const placeholders = agentIds.map(() => "?").join(",");
      return readAll<{ id: string; name: string }>(
        `select id, name from agents where id in (${placeholders}) and company_id = ?`,
        ...agentIds,
        companyId,
      );
    },

    /**
     * Returns ids of active agents with the given ids, filtered to the
     * company scope. Used by project-channel wake targeting to drop
     * terminated members before pinging.
     */
    listActiveAgentIdsFromIds(companyId: string, agentIds: readonly string[]): string[] {
      if (agentIds.length === 0) return [];
      const placeholders = agentIds.map(() => "?").join(",");
      return readAll<{ id: string }>(
        `select id from agents where id in (${placeholders}) and company_id = ? and status != 'terminated'`,
        ...agentIds,
        companyId,
      ).map((row) => row.id);
    },
  };
}
