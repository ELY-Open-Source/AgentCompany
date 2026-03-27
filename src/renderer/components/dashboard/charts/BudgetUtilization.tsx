import { useEffect, useMemo, useState } from "react";
import type { AgentRecord, BudgetStatusSummary } from "@shared/types";

interface BudgetUtilizationProps {
  companyId: string;
  agents: AgentRecord[];
}

interface BudgetRow {
  id: string;
  name: string;
  scopeType: string;
  spent: number;
  budget: number;
  pct: number;
}

function getBarColor(pct: number): string {
  if (pct >= 100) return "bg-[color:var(--danger)]";
  if (pct >= 80) return "bg-[color:var(--warn)]";
  return "bg-[color:var(--success)]";
}

function scopeLabel(scopeType: string): string {
  if (scopeType === "company") return "Company";
  if (scopeType === "project") return "Project";
  return "Agent";
}

export function BudgetUtilization({ companyId, agents }: BudgetUtilizationProps) {
  const [budgetStatus, setBudgetStatus] = useState<BudgetStatusSummary | null>(null);

  useEffect(() => {
    window.agentCompany.getBudgetStatus(companyId).then((result) => {
      if (result.ok) setBudgetStatus(result.data);
    });
  }, [companyId]);

  const rows = useMemo<BudgetRow[]>(() => {
    // Build rows from budget policies (company/agent/project scopes)
    const policyRows: BudgetRow[] = (budgetStatus?.policies ?? [])
      .filter((p) => p.amount > 0)
      .map((p) => {
        const agent = p.scopeType === "agent" ? agents.find((a) => a.id === p.scopeId) : undefined;
        const name = agent ? agent.name : `${scopeLabel(p.scopeType)} budget`;
        return {
          id: p.policyId,
          name,
          scopeType: p.scopeType,
          spent: p.spent,
          budget: p.amount,
          pct: Math.round((p.spent / p.amount) * 100),
        };
      });

    // Fallback: if no policies, use agent-level budgets from AgentRecord
    if (policyRows.length === 0) {
      return agents
        .filter((a) => a.budgetMonthlyUsd > 0)
        .map((a) => ({
          id: a.id,
          name: a.name,
          scopeType: "agent",
          spent: a.spentMonthlyUsd,
          budget: a.budgetMonthlyUsd,
          pct: Math.round((a.spentMonthlyUsd / a.budgetMonthlyUsd) * 100),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    // Sort: company first, then project, then agent
    const order: Record<string, number> = { company: 0, project: 1, agent: 2 };
    return policyRows.sort(
      (a, b) => (order[a.scopeType] ?? 3) - (order[b.scopeType] ?? 3) || a.name.localeCompare(b.name),
    );
  }, [budgetStatus, agents]);

  if (rows.length === 0) {
    return (
      <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-4">
        <div className="flex h-[120px] flex-col items-center justify-center gap-2">
          <span className="text-[13px] font-semibold text-[color:var(--muted)]">
            No budget policies configured
          </span>
          <span className="max-w-[200px] text-center text-[11px] text-[color:var(--muted)]">
            Set budget policies in Settings to track utilization here.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-4">
      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.id}>
            <div className="mb-1 flex items-center justify-between">
              <span className="flex items-center gap-2 text-[13px] font-semibold text-[color:var(--text)]">
                {row.name}
                <span className="text-[11px] font-normal text-[color:var(--muted)]">
                  {scopeLabel(row.scopeType)}
                </span>
              </span>
              <span
                className="text-[13px] text-[color:var(--muted)]"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {row.pct}%
              </span>
            </div>
            <div className="relative h-1.5 rounded-full bg-[color:var(--panel-soft)]">
              <div
                className={`h-1.5 rounded-full transition-all duration-300 ${getBarColor(row.pct)}`}
                style={{ width: `${Math.min(row.pct, 100)}%` }}
              />
              {/* 80% warning marker */}
              <div
                className="absolute top-0 h-full w-px bg-[color:var(--warn)] opacity-50"
                style={{ left: "80%" }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
