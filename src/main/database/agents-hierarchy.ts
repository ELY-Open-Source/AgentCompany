import type { DatabaseSync } from "node:sqlite";
import type { AgentRecord } from "@shared/types";
import {
  type ReadAll,
  type Transaction,
  nowIso,
  parseJson,
  toBoolean,
} from "./helpers";

export function buildAgentHierarchyMethods(
  getDb: () => DatabaseSync,
  readAll: ReadAll,
  transaction: Transaction,
  deps: {
    getAgent: (id: string) => AgentRecord;
  },
) {
  return {
    getChainOfCommand(agentId: string): AgentRecord[] {
      const chain: AgentRecord[] = [];
      const visited = new Set<string>();
      let current: AgentRecord | undefined;
      try {
        current = deps.getAgent(agentId);
      } catch {
        return chain;
      }
      while (current?.reportsTo) {
        if (visited.has(current.reportsTo)) {
          break;
        }
        visited.add(current.reportsTo);
        try {
          current = deps.getAgent(current.reportsTo);
          chain.push(current);
        } catch {
          break;
        }
      }
      return chain;
    },

    getDirectReports(agentId: string, companyId: string): AgentRecord[] {
      return readAll<AgentRecord>(
        "select id, company_id as companyId, name, role, title, department, status, reports_to as reportsTo, connector_id as connectorId, workspace_id as workspaceId, model, capabilities, budget_monthly_usd as budgetMonthlyUsd, spent_monthly_usd as spentMonthlyUsd, metadata_json as metadataJson, heartbeat_enabled as heartbeatEnabled, heartbeat_interval_sec as heartbeatIntervalSec, last_heartbeat_at as lastHeartbeatAt, created_at as createdAt, updated_at as updatedAt from agents where company_id = ? and reports_to = ?",
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

    listHeartbeatEligibleAgents(companyId: string): AgentRecord[] {
      return readAll<AgentRecord>(
        "select id, company_id as companyId, name, role, title, department, status, reports_to as reportsTo, connector_id as connectorId, workspace_id as workspaceId, model, capabilities, budget_monthly_usd as budgetMonthlyUsd, spent_monthly_usd as spentMonthlyUsd, metadata_json as metadataJson, heartbeat_enabled as heartbeatEnabled, heartbeat_interval_sec as heartbeatIntervalSec, last_heartbeat_at as lastHeartbeatAt, created_at as createdAt, updated_at as updatedAt from agents where company_id = ? and heartbeat_enabled = 1 and status not in ('terminated', 'paused', 'error', 'pending_approval')",
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

    getAgentPermissions(agentId: string): Record<string, boolean> {
      const row = getDb()
        .prepare("SELECT permissions_json FROM agents WHERE id = ?")
        .get(agentId) as { permissions_json: string } | undefined;
      return parseJson<Record<string, boolean>>(row?.permissions_json, {});
    },

    setAgentPermission(
      agentId: string,
      companyId: string,
      permissionKey: string,
      enabled: boolean,
    ): void {
      const row = getDb()
        .prepare("SELECT permissions_json FROM agents WHERE id = ?")
        .get(agentId) as { permissions_json: string } | undefined;
      const current = parseJson<Record<string, boolean>>(row?.permissions_json, {});
      if (enabled) {
        current[permissionKey] = true;
      } else {
        delete current[permissionKey];
      }
      const ts = nowIso();
      getDb()
        .prepare(
          "UPDATE agents SET permissions_json = ?, updated_at = ? WHERE id = ? AND company_id = ?",
        )
        .run(JSON.stringify(current), ts, agentId, companyId);
    },

    hasAgentPermission(agentId: string, permissionKey: string): boolean {
      const row = getDb()
        .prepare("SELECT permissions_json FROM agents WHERE id = ?")
        .get(agentId) as { permissions_json: string } | undefined;
      const perms = parseJson<Record<string, boolean>>(row?.permissions_json, {});
      return perms[permissionKey] === true;
    },

    getRuntimeState(agentId: string): Record<string, unknown> {
      const row = getDb()
        .prepare("SELECT runtime_state_json FROM agents WHERE id = ?")
        .get(agentId) as { runtime_state_json: string | null } | undefined;
      return parseJson<Record<string, unknown>>(row?.runtime_state_json, {});
    },

    setRuntimeState(
      agentId: string,
      companyId: string,
      state: Record<string, unknown>,
    ): void {
      const ts = nowIso();
      getDb()
        .prepare(
          "UPDATE agents SET runtime_state_json = ?, updated_at = ? WHERE id = ? AND company_id = ?",
        )
        .run(JSON.stringify(state), ts, agentId, companyId);
    },

    getHeartbeatPolicy(agentId: string): {
      enabled: boolean;
      intervalSec: number;
      cooldownSec: number;
      maxConcurrentRuns: number;
      wakeOnDemand: boolean;
    } {
      const row = getDb()
        .prepare(
          "SELECT heartbeat_enabled, heartbeat_interval_sec, heartbeat_policy_json FROM agents WHERE id = ?",
        )
        .get(agentId) as
        | {
            heartbeat_enabled: number;
            heartbeat_interval_sec: number;
            heartbeat_policy_json: string | null;
          }
        | undefined;
      if (!row) throw new Error(`Agent ${agentId} not found.`);
      const policy = parseJson<Record<string, unknown>>(row.heartbeat_policy_json, {});
      return {
        enabled: toBoolean(row.heartbeat_enabled),
        intervalSec: row.heartbeat_interval_sec ?? 120,
        cooldownSec: typeof policy.cooldownSec === "number" ? policy.cooldownSec : 10,
        maxConcurrentRuns:
          typeof policy.maxConcurrentRuns === "number" ? policy.maxConcurrentRuns : 1,
        wakeOnDemand: policy.wakeOnDemand !== false,
      };
    },

    setHeartbeatPolicy(
      agentId: string,
      companyId: string,
      policy: {
        enabled?: boolean;
        intervalSec?: number;
        cooldownSec?: number;
        maxConcurrentRuns?: number;
        wakeOnDemand?: boolean;
      },
    ): void {
      const row = getDb()
        .prepare(
          "SELECT heartbeat_enabled, heartbeat_interval_sec, heartbeat_policy_json FROM agents WHERE id = ?",
        )
        .get(agentId) as
        | {
            heartbeat_enabled: number;
            heartbeat_interval_sec: number;
            heartbeat_policy_json: string | null;
          }
        | undefined;
      if (!row) throw new Error(`Agent ${agentId} not found.`);
      const current = parseJson<Record<string, unknown>>(row.heartbeat_policy_json, {});
      const merged = {
        enabled: policy.enabled ?? toBoolean(row.heartbeat_enabled),
        intervalSec: policy.intervalSec ?? row.heartbeat_interval_sec ?? 120,
        cooldownSec:
          policy.cooldownSec ??
          (typeof current.cooldownSec === "number" ? current.cooldownSec : 10),
        maxConcurrentRuns:
          policy.maxConcurrentRuns ??
          (typeof current.maxConcurrentRuns === "number" ? current.maxConcurrentRuns : 1),
        wakeOnDemand: policy.wakeOnDemand ?? (current.wakeOnDemand !== false),
      };
      const policyJson = JSON.stringify({
        cooldownSec: merged.cooldownSec,
        maxConcurrentRuns: merged.maxConcurrentRuns,
        wakeOnDemand: merged.wakeOnDemand,
      });
      const ts = nowIso();
      getDb()
        .prepare(
          "UPDATE agents SET heartbeat_enabled = ?, heartbeat_interval_sec = ?, heartbeat_policy_json = ?, updated_at = ? WHERE id = ? AND company_id = ?",
        )
        .run(merged.enabled ? 1 : 0, merged.intervalSec, policyJson, ts, agentId, companyId);
    },
  };
}
