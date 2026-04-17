import type { DatabaseSync } from "node:sqlite";
import type { AgentRecord, ConnectorId, TaskRecord } from "@shared/types";
import type { ReadAll, Transaction } from "./helpers";
import { ensureId, normalizeOptionalId, nowIso } from "./helpers";

/**
 * Goal row shape returned by listGoals / getGoalForUpdate. Mirrors the
 * historical inline SQL projection in routes-work-graph.ts so HTTP
 * responses stay byte-stable.
 */
export type GoalListRow = {
  id: string;
  companyId: string;
  title: string;
  description: string;
  parentId: string | null;
  ownerAgentId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Project row shape returned by listProjects / getProjectForUpdate.
 * Mirrors the historical inline SQL projection in routes-work-graph.ts.
 */
export type ProjectListRow = {
  id: string;
  companyId: string;
  goalId: string | null;
  name: string;
  description: string;
  leadAgentId: string | null;
  status: string;
  targetDate: string | null;
  createdAt: string;
  updatedAt: string;
};

export function buildEntityCrudMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
  _deps: {
    addActivity: (input: { companyId: string; actor: string; action: string; entityType: string; entityId: string; detail: string }) => void;
  },
) {
  return {
    getTask(id: string): TaskRecord {
      const row = getDb()
        .prepare(
          "select id, company_id as companyId, project_id as projectId, goal_id as goalId, parent_id as parentId, title, description, assignee_agent_id as assigneeAgentId, workspace_id as workspaceId, status, priority, active_run_id as activeRunId, session_json as sessionJson, session_display_id as sessionDisplayId, cost_usd as costUsd, task_type as taskType, requires_user_review as requiresUserReview, is_heartbeat as isHeartbeat, started_at as startedAt, completed_at as completedAt, cancelled_at as cancelledAt, created_at as createdAt, updated_at as updatedAt from tasks where id = ?",
        )
        .get(id) as TaskRecord | undefined;
      if (!row) throw new Error(`Task not found: ${id}`);
      row.requiresUserReview = Boolean(row.requiresUserReview);
      row.isHeartbeat = Boolean(row.isHeartbeat);
      row.startedAt = row.startedAt ?? null;
      row.completedAt = row.completedAt ?? null;
      row.cancelledAt = row.cancelledAt ?? null;
      return row;
    },

    getAgent(id: string): AgentRecord {
      const row = getDb()
        .prepare(
          "select id, company_id as companyId, name, role, title, department, status, reports_to as reportsTo, connector_id as connectorId, workspace_id as workspaceId, model, capabilities, role_level as roleLevel, budget_monthly_usd as budgetMonthlyUsd, spent_monthly_usd as spentMonthlyUsd, metadata_json as metadataJson, heartbeat_enabled as heartbeatEnabled, heartbeat_interval_sec as heartbeatIntervalSec, last_heartbeat_at as lastHeartbeatAt, session_id as sessionId, created_at as createdAt, updated_at as updatedAt from agents where id = ?",
        )
        .get(id) as AgentRecord | undefined;
      if (!row) throw new Error(`Agent not found: ${id}`);
      row.heartbeatEnabled = Boolean(row.heartbeatEnabled);
      return row;
    },

    findAgent(id: string): AgentRecord | null {
      const row = getDb()
        .prepare(
          "select id, company_id as companyId, name, role, title, department, status, reports_to as reportsTo, connector_id as connectorId, workspace_id as workspaceId, model, capabilities, role_level as roleLevel, budget_monthly_usd as budgetMonthlyUsd, spent_monthly_usd as spentMonthlyUsd, metadata_json as metadataJson, heartbeat_enabled as heartbeatEnabled, heartbeat_interval_sec as heartbeatIntervalSec, last_heartbeat_at as lastHeartbeatAt, session_id as sessionId, created_at as createdAt, updated_at as updatedAt from agents where id = ?",
        )
        .get(id) as AgentRecord | undefined;
      if (!row) return null;
      row.heartbeatEnabled = Boolean(row.heartbeatEnabled);
      return row;
    },

    /**
     * Returns all goals for a company. Used by GET /api/companies/:id/goals.
     */
    listGoals(companyId: string): GoalListRow[] {
      return readAll<GoalListRow>(
        "select id, company_id as companyId, title, description, parent_id as parentId, owner_agent_id as ownerAgentId, status, created_at as createdAt, updated_at as updatedAt from goals where company_id = ? order by created_at asc",
        companyId,
      );
    },

    /**
     * Returns the goal lookup row used by PATCH /api/goals/:goalId.
     * Returns null when the goal is missing or belongs to another company.
     */
    getGoalForUpdate(goalId: string, companyId: string): GoalListRow | null {
      const row = getDb()
        .prepare(
          "select id, company_id as companyId, title, description, parent_id as parentId, owner_agent_id as ownerAgentId, status, created_at as createdAt, updated_at as updatedAt from goals where id = ? and company_id = ? limit 1",
        )
        .get(goalId, companyId) as GoalListRow | undefined;
      return row ?? null;
    },

    /**
     * Returns all projects for a company. Used by
     * GET /api/companies/:id/projects.
     */
    listProjects(companyId: string): ProjectListRow[] {
      return readAll<ProjectListRow>(
        "select id, company_id as companyId, goal_id as goalId, name, description, lead_agent_id as leadAgentId, status, target_date as targetDate, created_at as createdAt, updated_at as updatedAt from projects where company_id = ? order by created_at desc",
        companyId,
      );
    },

    /**
     * Returns the project lookup row used by PATCH /api/projects/:projectId.
     * Returns null when the project is missing or belongs to another company.
     */
    getProjectForUpdate(projectId: string, companyId: string): ProjectListRow | null {
      const row = getDb()
        .prepare(
          "select id, company_id as companyId, goal_id as goalId, name, description, lead_agent_id as leadAgentId, status, target_date as targetDate, created_at as createdAt, updated_at as updatedAt from projects where id = ? and company_id = ? limit 1",
        )
        .get(projectId, companyId) as ProjectListRow | undefined;
      return row ?? null;
    },

    saveGoal(input: { id?: string | null; companyId: string; title: string; description: string; parentId?: string | null; ownerAgentId?: string | null; status: string }) {
      const id = ensureId(input.id ?? null);
      const ts = nowIso();
      const existing = getDb().prepare("select id from goals where id = ? and company_id = ?").get(id, input.companyId) as { id: string } | undefined;
      if (existing) {
        getDb()
          .prepare(
            "update goals set title = ?, description = ?, parent_id = ?, owner_agent_id = ?, status = ?, updated_at = ? where id = ? and company_id = ?",
          )
          .run(input.title, input.description, normalizeOptionalId(input.parentId), normalizeOptionalId(input.ownerAgentId), input.status, ts, id, input.companyId);
      } else {
        getDb()
          .prepare(
            "insert into goals (id, company_id, title, description, parent_id, owner_agent_id, status, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(id, input.companyId, input.title, input.description, normalizeOptionalId(input.parentId), normalizeOptionalId(input.ownerAgentId), input.status, ts, ts);
      }
      return id;
    },

    saveProject(input: { id?: string | null; companyId: string; goalId?: string | null; name: string; description: string; leadAgentId?: string | null; targetDate?: string | null; status: string }) {
      const id = ensureId(input.id ?? null);
      const ts = nowIso();
      const existing = getDb().prepare("select id from projects where id = ? and company_id = ?").get(id, input.companyId) as { id: string } | undefined;
      if (existing) {
        getDb()
          .prepare(
            "update projects set goal_id = ?, name = ?, description = ?, lead_agent_id = ?, status = ?, target_date = ?, updated_at = ? where id = ? and company_id = ?",
          )
          .run(normalizeOptionalId(input.goalId), input.name, input.description, normalizeOptionalId(input.leadAgentId), input.status, normalizeOptionalId(input.targetDate), ts, id, input.companyId);
      } else {
        getDb()
          .prepare(
            "insert into projects (id, company_id, goal_id, name, description, lead_agent_id, status, target_date, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(id, input.companyId, normalizeOptionalId(input.goalId), input.name, input.description, normalizeOptionalId(input.leadAgentId), input.status, normalizeOptionalId(input.targetDate), ts, ts);
      }
      return id;
    },

    saveSecret(input: { id?: string | null; companyId: string; name: string; description: string; value: string }, vault: { encrypt: (v: string) => { backend: string; payload: Uint8Array } }) {
      const id = ensureId(input.id ?? null);
      const encrypted = vault.encrypt(input.value);
      const ts = nowIso();
      const existing = getDb().prepare("select id, company_id as companyId from secrets where id = ?").get(id) as
        | { id: string; companyId: string }
        | undefined;
      if (existing) {
        if (existing.companyId !== input.companyId) {
          throw new Error("Secrets cannot be moved across companies.");
        }
        getDb()
          .prepare("update secrets set name = ?, description = ?, backend = ?, ciphertext = ?, updated_at = ? where id = ? and company_id = ?")
          .run(input.name, input.description, encrypted.backend, encrypted.payload, ts, id, input.companyId);
      } else {
        getDb()
          .prepare("insert into secrets (id, company_id, name, description, backend, ciphertext, updated_at, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(id, input.companyId, input.name, input.description, encrypted.backend, encrypted.payload, ts, ts);
      }
      return id;
    },

    resolveSecretEnv(bindingText: string, companyId: string, vault: { decrypt: (backend: "safe_storage" | "vault", ciphertext: Buffer) => string }, listInvalidEnvBindingKeys: (t: string) => string[], parseEnvBindingText: (t: string) => Record<string, string>): Record<string, string> {
      const invalidKeys = new Set(listInvalidEnvBindingKeys(bindingText));
      const bindings = parseEnvBindingText(bindingText);
      const result: Record<string, string> = {};
      for (const [envKey, rawValue] of Object.entries(bindings)) {
        if (invalidKeys.has(envKey)) continue;
        const row = getDb().prepare("select backend, ciphertext from secrets where company_id = ? and name = ?").get(companyId, rawValue) as
          | { backend: "safe_storage" | "vault"; ciphertext: Uint8Array }
          | undefined;
        if (row) {
          result[envKey] = vault.decrypt(row.backend, Buffer.from(row.ciphertext));
        } else {
          result[envKey] = rawValue;
        }
      }
      return result;
    },

    deleteGoal(id: string, companyId: string) {
      transaction(() => {
        getDb().prepare("update goals set parent_id = null where parent_id = ? and company_id = ?").run(id, companyId);
        getDb().prepare("update projects set goal_id = null where goal_id = ? and company_id = ?").run(id, companyId);
        getDb().prepare("update tasks set goal_id = null where goal_id = ? and company_id = ?").run(id, companyId);
        getDb().prepare("delete from goals where id = ? and company_id = ?").run(id, companyId);
      });
    },

    deleteProject(id: string, companyId: string) {
      transaction(() => {
        getDb().prepare("update tasks set project_id = null where project_id = ? and company_id = ?").run(id, companyId);
        getDb().prepare("update workspaces set project_id = null where project_id = ? and company_id = ?").run(id, companyId);
        getDb().prepare("delete from projects where id = ? and company_id = ?").run(id, companyId);
      });
    },

    deleteSecret(id: string, companyId: string) {
      getDb().prepare("delete from secrets where id = ? and company_id = ?").run(id, companyId);
    },

    countActiveGoalsForCompany(companyId: string): number {
      const row = getDb().prepare(
        "select count(*) as cnt from goals where company_id = ? and status in ('active', 'planned')",
      ).get(companyId) as { cnt: number };
      return row.cnt;
    },

    createHireRequest(input: {
      companyId: string; requestedByAgentId?: string | null;
      name: string; role: string; title: string; department?: string | null;
      reportsTo?: string | null; connectorId: ConnectorId; workspaceId?: string | null;
      model?: string | null; metadataJson?: string; capabilities: string;
      budgetMonthlyUsd: number; payloadSummary: string; impactSummary: string;
      payloadJson?: string | null;
    }, selfDeps: {
      saveAgent: (input: {
        companyId: string; name: string; role: string; title: string;
        department: string | null; status: AgentRecord["status"];
        reportsTo: string | null; connectorId: ConnectorId;
        workspaceId: string | null; model: string | null;
        metadataJson: string; capabilities: string; budgetMonthlyUsd: number;
      }) => string;
      requestApproval: (input: {
        companyId: string; requestedByAgentId: string | null;
        relatedAgentId: string; type: string;
        payloadSummary: string; impactSummary: string;
        payloadJson: string | null;
      }) => string;
    }) {
      return transaction(() => {
        const agentId = selfDeps.saveAgent({
          companyId: input.companyId, name: input.name, role: input.role,
          title: input.title, department: input.department ?? null,
          status: "pending_approval", reportsTo: input.reportsTo ?? null,
          connectorId: input.connectorId, workspaceId: input.workspaceId ?? null,
          model: input.model ?? null, metadataJson: input.metadataJson ?? "{}",
          capabilities: input.capabilities, budgetMonthlyUsd: input.budgetMonthlyUsd,
        });
        const approvalId = selfDeps.requestApproval({
          companyId: input.companyId,
          requestedByAgentId: input.requestedByAgentId ?? null,
          relatedAgentId: agentId,
          type: "hire_agent",
          payloadSummary: input.payloadSummary,
          impactSummary: input.impactSummary,
          payloadJson: input.payloadJson ?? null,
        });
        return { agentId, approvalId };
      });
    },

    incrementActiveSprintVelocity(companyId: string, delta: number) {
      const ts = nowIso();
      const today = ts.slice(0, 10);
      getDb().prepare(
        "update sprints set completed_points = max(0, completed_points + ?), updated_at = ? where company_id = ? and status = 'active' and start_date <= ? and end_date >= ?",
      ).run(delta, ts, companyId, today, today);
    },
  };
}
