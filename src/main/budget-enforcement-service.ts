import type { AppDatabase } from "./database";
import type { NotificationOptions } from "./notification-service";
import type { BudgetPolicyRecord, BudgetStatusSummary } from "@shared/types";

interface BudgetEnforcementDependencies {
  db: AppDatabase;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  notify: (options: NotificationOptions) => void;
  publishDomainChanged: () => void;
}

export interface BudgetGateResult {
  allowed: boolean;
  blockedBy: Array<{
    policyId: string;
    scopeType: string;
    scopeId: string;
    spent: number;
    limit: number;
  }>;
}

/**
 * Returns a human-readable label for a budget policy scope.
 * Looks up entity names from the database for agent and project scopes.
 */
function getScopeLabel(db: AppDatabase, policy: BudgetPolicyRecord): string {
  if (policy.scopeType === "agent") {
    try {
      const agents = db.loadSnapshot(null).agents;
      const agent = agents.find((a) => a.id === policy.scopeId);
      return agent ? `Agent "${agent.name}"` : `Agent ${policy.scopeId.slice(0, 8)}`;
    } catch {
      return `Agent ${policy.scopeId.slice(0, 8)}`;
    }
  }
  if (policy.scopeType === "project") {
    try {
      const projects = db.loadSnapshot(null).projects;
      const project = projects.find((p) => p.id === policy.scopeId);
      return project ? `Project "${project.name}"` : `Project ${policy.scopeId.slice(0, 8)}`;
    } catch {
      return `Project ${policy.scopeId.slice(0, 8)}`;
    }
  }
  return "Company budget";
}

export function createBudgetEnforcementService({
  db,
  logger,
  notify,
  publishDomainChanged,
}: BudgetEnforcementDependencies) {
  /**
   * Evaluates whether a new run should be allowed based on active budget policies.
   *
   * Per D-01 (strictest-wins): if ANY policy scope is exhausted, the run is blocked.
   * Per D-02: if no policies exist, the run is allowed (unlimited).
   * Per D-04/D-05: this only blocks NEW dispatches -- in-flight runs are unaffected.
   */
  function evaluateBudgetGate(
    companyId: string,
    agentId: string,
    projectId: string | null,
  ): BudgetGateResult {
    const policies = db.getActivePoliciesForRun(companyId, agentId, projectId);
    if (policies.length === 0) {
      return { allowed: true, blockedBy: [] };
    }

    const blockedBy: BudgetGateResult["blockedBy"] = [];
    for (const policy of policies) {
      if (!policy.hardStopEnabled) continue;
      const spent = db.getSpentInWindow(policy);
      if (spent >= policy.amount) {
        blockedBy.push({
          policyId: policy.id,
          scopeType: policy.scopeType,
          scopeId: policy.scopeId,
          spent,
          limit: policy.amount,
        });
      }
    }

    return { allowed: blockedBy.length === 0, blockedBy };
  }

  /**
   * Checks all active policies for the given run context and creates/updates
   * budget incidents at warn and hard-stop thresholds.
   *
   * Per D-07: fires both warn and hard-stop in the same code path.
   * Per D-08: deduplicates incidents via upsertBudgetIncident.
   */
  function checkAndCreateIncidents(
    companyId: string,
    agentId: string,
    projectId: string | null,
  ): void {
    const policies = db.getActivePoliciesForRun(companyId, agentId, projectId);

    for (const policy of policies) {
      // Guard against division by zero
      if (policy.amount <= 0) continue;

      const spent = db.getSpentInWindow(policy);
      const utilization = spent / policy.amount;
      const warnThreshold = policy.warnPercent / 100;
      const scopeLabel = getScopeLabel(db, policy);

      if (utilization >= warnThreshold) {
        db.upsertBudgetIncident(policy, "warn_threshold", spent);
        if (policy.notifyEnabled) {
          notify({
            title: "Budget Warning",
            body: `${scopeLabel} at ${Math.round(utilization * 100)}% of budget ($${(spent / 100).toFixed(2)} / $${(policy.amount / 100).toFixed(2)})`,
            urgency: "informational",
            navigation: { section: "costs" },
            batchKey: "budget_warning",
          });
        }
      }

      if (utilization >= 1.0 && policy.hardStopEnabled) {
        db.upsertBudgetIncident(policy, "hard_stop", spent);
        if (policy.notifyEnabled) {
          notify({
            title: "Budget Exhausted",
            body: `${scopeLabel} budget exhausted - new runs blocked`,
            urgency: "critical",
            navigation: { section: "costs" },
            batchKey: "budget_exhaustion",
          });
        }
      }
    }

    publishDomainChanged();
  }

  /**
   * Checks if a policy's limit was increased above the observed spend amount,
   * and auto-resolves open incidents if so.
   *
   * Per D-06: fires auto_resolved_limit_increase status.
   */
  function checkAutoResolve(companyId: string, policyId: string): void {
    const policy = db.getBudgetPolicy(policyId);
    if (!policy) return;

    const spent = db.getSpentInWindow(policy);
    let resolved = false;

    // If spend is below hard-stop threshold, resolve all open incidents
    if (spent < policy.amount) {
      const count = db.resolveIncidentsForPolicy(policyId, "auto_resolved_limit_increase");
      if (count > 0) resolved = true;
    }

    // If spend is below warn threshold, resolve warn incidents specifically
    const warnAmount = Math.floor((policy.amount * policy.warnPercent) / 100);
    if (spent < warnAmount) {
      const count = db.resolveWarnIncidentsForPolicy(policyId, "auto_resolved_limit_increase");
      if (count > 0) resolved = true;
    }

    if (resolved) {
      logger.info(`Budget auto-resolve: policy ${policyId} incidents resolved (spent=${spent}, limit=${policy.amount})`);
      publishDomainChanged();
    }
  }

  /**
   * Closes incidents whose calendar month window has ended.
   * Per D-06: window rollover cleanup.
   */
  function autoCloseExpiredIncidents(companyId: string): number {
    const count = db.autoCloseExpiredIncidents(companyId);
    if (count > 0) {
      logger.info(`Budget auto-close: ${count} expired incident(s) for company ${companyId}`);
      publishDomainChanged();
    }
    return count;
  }

  /**
   * Returns a summary of all budget policies and their current spend status.
   */
  function getBudgetStatus(companyId: string): BudgetStatusSummary {
    const policies = db.listBudgetPolicies(companyId);
    const openIncidents = db.listBudgetIncidents(companyId, "open");

    return {
      policies: policies.map((policy) => {
        const spent = db.getSpentInWindow(policy);
        const hasOpenIncident = openIncidents.some((i) => i.policyId === policy.id);
        return {
          policyId: policy.id,
          scopeType: policy.scopeType,
          scopeId: policy.scopeId,
          amount: policy.amount,
          spent,
          warnPercent: policy.warnPercent,
          hardStopEnabled: policy.hardStopEnabled,
          hasOpenIncident,
        };
      }),
    };
  }

  return {
    evaluateBudgetGate,
    checkAndCreateIncidents,
    checkAutoResolve,
    autoCloseExpiredIncidents,
    getBudgetStatus,
  };
}
