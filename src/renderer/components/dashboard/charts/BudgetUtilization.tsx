import { useMemo } from "react";
import type { AgentRecord } from "@shared/types";

interface BudgetUtilizationProps {
  companyId: string;
  agents: AgentRecord[];
}

interface BudgetRow {
  id: string;
  name: string;
  spent: number;
  budget: number;
  pct: number;
}

function getBarColor(pct: number): string {
  if (pct >= 100) return "bg-[color:var(--danger)]";
  if (pct >= 80) return "bg-[color:var(--warn)]";
  return "bg-[color:var(--success)]";
}

export function BudgetUtilization({ companyId: _companyId, agents }: BudgetUtilizationProps) {
  const rows = useMemo<BudgetRow[]>(() => {
    return agents
      .filter((a) => a.budgetMonthlyUsd > 0)
      .map((a) => ({
        id: a.id,
        name: a.name,
        spent: a.spentMonthlyUsd,
        budget: a.budgetMonthlyUsd,
        pct: Math.round((a.spentMonthlyUsd / a.budgetMonthlyUsd) * 100),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [agents]);

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
              <span className="text-[13px] font-semibold text-[color:var(--text)]">
                {row.name}
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
