import log from "electron-log/main.js";
import type {
  AgentRecord,
  ConnectorId,
  ConnectorRecord,
  ModelCapability,
  TaskTier,
} from "@shared/types";
import { getConnectorExecutionReadinessIssue } from "@shared/connector-policy";
import { getConnectorDefinition } from "./connectors";
import { getConnectorModelPolicy } from "./connector-model-policy";
import { inferTaskProfile } from "./agent-role-helpers";

/**
 * Resolves which (provider, modelId) to use for an agent at run dispatch.
 *
 * The rule is spelled out in the design discussion:
 *
 *   1. `explicit` strategy (or a CEO role):
 *      use agent.connectorId + agent.model verbatim. CEO is always pinned
 *      to whatever the user chose on the Agent form.
 *
 *   2. Only one enabled (provider, modelId) pair exists anywhere:
 *      use it. Whether it's the CEO's pick or a lone API-key connector,
 *      single-model installs should not exercise the dispatcher at all.
 *
 *   3. `auto` strategy with multiple candidates:
 *      infer the agent's task profile (domain ∈ reasoning|coding|writing,
 *      required tier ∈ trivial|standard|hard), filter enabled candidates
 *      to those whose capability row clears both the domain score and the
 *      tier floor, and pick the cheapest among them.
 *
 *   4. No candidate clears the bar in `auto`:
 *      fall back to the CEO's (connectorId, model). Runs must not fail
 *      because the capability matrix is under-seeded — No regressions.
 */

export interface EnabledModel {
  provider: string;
  connectorId: ConnectorId;
  modelId: string;
}

export interface AgentAssignment {
  connectorId: ConnectorId;
  modelId: string | null;
}

export interface PickModelDeps {
  getConnector: (id: ConnectorId) => ConnectorRecord;
  getDisabledModels: (companyId: string, connectorId: string) => Array<{ id: string; label: string }>;
  /**
   * Thin projection of the CEO for fallback. Returns `null` when the
   * company has no CEO yet (pre-bootstrap). The picker only needs enough
   * to route a run, so we don't demand the full AgentRecord — keeping the
   * surface narrow lets callers use the existing `db.getCeoForCompany`
   * together with a single `getAgent` lookup for the fallback pair.
   */
  getCeoAssignment: (companyId: string) => { connectorId: ConnectorId; modelId: string | null } | null;
  listModelCapabilities: () => ModelCapability[];
  readConnectors: () => ConnectorRecord[];
}

/**
 * Minimum numeric score per tier — the model must score *at least* this on
 * the task's domain axis. Higher tiers demand strictly higher scores; a
 * tier-3 (hard) task refuses any model that scores below 4 on its domain
 * regardless of the model's own tier flag. Tuned to the 5-grade rubric.
 */
const DOMAIN_SCORE_FLOOR: Record<TaskTier, number> = {
  trivial: 2,
  standard: 3,
  hard: 4,
};

const TIER_RANK: Record<TaskTier, number> = {
  trivial: 1,
  standard: 2,
  hard: 3,
};

/**
 * Walk every connector the user has configured, keep the ones that are
 * execution-ready (authenticated, healthy), and expand each to its enabled
 * model list. Returns a flat list of (provider, connectorId, modelId) triples
 * — the concrete universe the picker chooses from.
 */
export function listEnabledModels(companyId: string, deps: PickModelDeps): EnabledModel[] {
  const result: EnabledModel[] = [];
  for (const connector of deps.readConnectors()) {
    if (getConnectorExecutionReadinessIssue(connector)) continue;
    let definition;
    try {
      definition = getConnectorDefinition(connector.id);
    } catch (err) {
      log.warn(`[model-dispatch] Skipping unknown connector ${connector.id}:`, err instanceof Error ? err.message : String(err));
      continue;
    }
    const policy = getConnectorModelPolicy(deps, companyId, connector.id as ConnectorId);
    for (const model of policy.enabledModels) {
      result.push({
        provider: definition.provider,
        connectorId: connector.id as ConnectorId,
        modelId: model.id,
      });
    }
  }
  return result;
}

/**
 * Pure scoring step. Given the agent's inferred profile, the capability
 * matrix, and the concrete list of enabled (provider, modelId) pairs,
 * pick the cheapest qualifying model — or return `null` when nothing
 * clears the bar so the caller can apply its fallback.
 *
 * Split out from `pickModelForAgent` so unit tests can exercise the
 * rubric without having to stand up the real connector catalog or
 * policy lookups.
 */
export function pickFromCandidates(
  profile: { domain: "reasoning" | "coding" | "writing"; requiredTier: TaskTier },
  enabled: EnabledModel[],
  capabilities: ModelCapability[],
): EnabledModel | null {
  if (enabled.length === 0) return null;
  const domainFloor = DOMAIN_SCORE_FLOOR[profile.requiredTier];
  const tierFloor = TIER_RANK[profile.requiredTier];

  const capabilityByKey = new Map<string, ModelCapability>();
  for (const cap of capabilities) {
    capabilityByKey.set(`${cap.provider}::${cap.modelId}`, cap);
  }

  const qualifying: Array<{ model: EnabledModel; cap: ModelCapability }> = [];
  for (const model of enabled) {
    const cap = capabilityByKey.get(`${model.provider}::${model.modelId}`);
    if (!cap) continue;
    if (cap[profile.domain] < domainFloor) continue;
    if (TIER_RANK[cap.tier] < tierFloor) continue;
    qualifying.push({ model, cap });
  }
  if (qualifying.length === 0) return null;

  qualifying.sort((a, b) => a.cap.costPerMtokOut - b.cap.costPerMtokOut);
  return qualifying[0]!.model;
}

/**
 * The one-call entry point that run dispatch uses. Returns the pair to
 * burn into the run record; callers pass it straight into `createRun` and
 * the worker payload.
 */
export function pickModelForAgent(
  agent: AgentRecord,
  deps: PickModelDeps,
): AgentAssignment {
  const strategy = agent.modelStrategy ?? "explicit";

  // CEO is pinned to the user's choice. The canonical CEO marker is
  // `reportsTo === null` — the DB invariant (`getCeoForCompany` SELECTs on
  // the same predicate), so this holds even when `roleLevel` is still the
  // schema default 'ic' on an agent that was never tagged with the full
  // seniority enum. We also accept the enum for completeness.
  const isCeo = agent.reportsTo === null || agent.roleLevel === "c_suite";
  if (strategy === "explicit" || isCeo) {
    return { connectorId: agent.connectorId, modelId: agent.model ?? null };
  }

  const enabled = listEnabledModels(agent.companyId, deps);

  // Single-model install: there's nothing to pick from. Use it.
  if (enabled.length === 1) {
    const only = enabled[0]!;
    return { connectorId: only.connectorId, modelId: only.modelId };
  }

  // Empty universe → fall back to whatever is on the agent row. This can
  // only happen when every connector is unhealthy; the eligibility checks
  // higher up in run dispatch will still block the run, but we return
  // something sensible so the caller's contract stays total.
  if (enabled.length === 0) {
    return { connectorId: agent.connectorId, modelId: agent.model ?? null };
  }

  const profile = inferTaskProfile(agent.role, agent.title, agent.roleLevel);
  const winner = pickFromCandidates(profile, enabled, deps.listModelCapabilities());

  if (!winner) {
    // Fall back to the CEO's explicit pair. If there is no CEO (fresh
    // company, board-only), fall back to agent's own row so we never
    // throw. The upstream readiness check owns whether to let the run
    // actually start.
    const ceo = deps.getCeoAssignment(agent.companyId);
    if (ceo) return ceo;
    return { connectorId: agent.connectorId, modelId: agent.model ?? null };
  }

  return { connectorId: winner.connectorId, modelId: winner.modelId };
}

/**
 * Re-export for test setups that want to exercise the rubric without
 * standing up a full AgentRecord.
 */
export const __INTERNAL__ = {
  DOMAIN_SCORE_FLOOR,
  TIER_RANK,
};
