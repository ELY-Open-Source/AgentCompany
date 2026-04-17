import { formatMoney } from "../../lib/formatters";

export function BudgetBar({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
  const overBudget = spent > budget && budget > 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[color:var(--border)]">
        <div
          className={`h-full rounded-full transition-all ${overBudget ? "bg-destructive" : "bg-success"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-[11px] ${overBudget ? "text-destructive" : "text-muted-foreground"}`}>
        {formatMoney(spent)} / {formatMoney(budget)}
      </span>
    </div>
  );
}
