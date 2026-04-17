import type { DatabaseSync } from "node:sqlite";
import { type ReadAll, type Transaction, nowIso, parseJson, toBoolean } from "./helpers";

/**
 * Agent permission, runtime-state, and heartbeat-policy helpers extracted
 * from agents-hierarchy.ts. Every method is spread into the final
 * `buildAgentMethods` result so AppDatabase call-sites remain unchanged.
 */
export function buildAgentPermissionMethods(
  getDb: () => DatabaseSync,
  _readAll: ReadAll,
  _transaction: Transaction,
) {
  return {
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
