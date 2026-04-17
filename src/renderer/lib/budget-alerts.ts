import type { AgentRecord, BudgetIncidentRecord } from "@shared/types";

export type BudgetAlertSeverity = "warn" | "danger";

export interface BudgetAlert {
  id: string;
  severity: BudgetAlertSeverity;
  title: string;
  scopeLabel: string;
  pct: number;
  observedUsd: number;
  limitUsd: number;
}

/**
 * Unify policy-based BudgetIncidentRecord alerts and fallback agent-level
 * threshold alerts into a single `BudgetAlert[]`.
 *
 * When `incidents` is non-empty, policy-based alerts are used exclusively.
 * Otherwise we derive alerts from agents whose month-to-date spend crosses
 * 80% of their monthly budget.
 */
export function computeBudgetAlerts(
  incidents: BudgetIncidentRecord[],
  agents: AgentRecord[],
): BudgetAlert[] {
  if (incidents.length > 0) {
    return incidents.map((incident) => {
      const pct = incident.amountLimit > 0
        ? Math.round((incident.amountObserved / incident.amountLimit) * 100)
        : 0;
      const isHardStop = incident.thresholdType === "hard_stop";
      const scopeLabel = getScopeLabel(incident.scopeType, incident.scopeId, agents);
      return {
        id: incident.id,
        severity: isHardStop ? "danger" : "warn",
        title: isHardStop ? "Budget Hard Stop" : "Budget Warning",
        scopeLabel,
        pct,
        observedUsd: incident.amountObserved / 100,
        limitUsd: incident.amountLimit / 100,
      };
    });
  }

  return agents
    .filter((a) => a.budgetMonthlyUsd > 0 && a.spentMonthlyUsd / a.budgetMonthlyUsd >= 0.8)
    .map((a): BudgetAlert => {
      const pct = Math.round((a.spentMonthlyUsd / a.budgetMonthlyUsd) * 100);
      return {
        id: a.id,
        severity: pct >= 100 ? "danger" : "warn",
        title: "Budget Alert",
        scopeLabel: a.name,
        pct,
        observedUsd: a.spentMonthlyUsd,
        limitUsd: a.budgetMonthlyUsd,
      };
    })
    .sort((a, b) => b.pct - a.pct);
}

function getScopeLabel(scopeType: string, scopeId: string, agents: AgentRecord[]): string {
  if (scopeType === "company") return "Company";
  if (scopeType === "agent") {
    const agent = agents.find((a) => a.id === scopeId);
    return agent ? agent.name : scopeId.slice(0, 8);
  }
  return scopeId.slice(0, 8);
}
