import type { AgentRecord, ApprovalRecord } from "@shared/types";
import { formatMoney } from "../../lib/formatters";
import { useT } from "../../i18n";

interface TeamHeaderSummaryProps {
  agents: AgentRecord[];
  pendingApprovals: ApprovalRecord[];
}

/**
 * Compact summary strip above the org chart. Answers the "what's going on
 * with the team right now?" question without requiring the user to scan
 * the chart + roster + approvals pages separately.
 *
 * Shows: total members, how many are actively running, how many need
 * attention (paused/error/pending_approval), pending hire approvals,
 * and aggregate monthly budget burn. Computed from existing snapshot
 * data — no extra IPC round-trip.
 */
export function TeamHeaderSummary({ agents, pendingApprovals }: TeamHeaderSummaryProps) {
  const t = useT();

  const active = agents.filter((a) => a.status !== "terminated");
  const running = active.filter((a) => a.status === "running").length;
  const attention = active.filter(
    (a) => a.status === "paused" || a.status === "error" || a.status === "pending_approval",
  ).length;
  const pendingHires = pendingApprovals.filter((a) => a.type === "hire_agent" && a.state === "pending").length;

  const totalBudget = active.reduce((sum, a) => sum + (a.budgetMonthlyUsd ?? 0), 0);
  const totalSpent = active.reduce((sum, a) => sum + (a.spentMonthlyUsd ?? 0), 0);
  const budgetPct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;

  const items: Array<{ label: string; value: string; emphasis?: "warn" | "muted" }> = [
    { label: t("team.summary.members"), value: String(active.length) },
    { label: t("team.summary.running"), value: String(running) },
    {
      label: t("team.summary.attention"),
      value: String(attention),
      emphasis: attention > 0 ? "warn" : "muted",
    },
    {
      label: t("team.summary.pendingHires"),
      value: String(pendingHires),
      emphasis: pendingHires > 0 ? "warn" : "muted",
    },
    {
      label: t("team.summary.budget"),
      value:
        totalBudget > 0
          ? t("team.summary.budgetFormat")
              .replace("{spent}", formatMoney(totalSpent))
              .replace("{budget}", formatMoney(totalBudget))
              .replace("{pct}", String(budgetPct))
          : formatMoney(totalSpent),
    },
  ];

  return (
    <div className="flex flex-wrap items-stretch gap-x-6 gap-y-2 rounded-lg border border-border bg-card px-4 py-3">
      {items.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {item.label}
          </span>
          <span
            className={`text-[16px] font-semibold leading-tight ${
              item.emphasis === "warn"
                ? "text-warning"
                : item.emphasis === "muted"
                  ? "text-muted-foreground"
                  : "text-foreground"
            }`}
          >
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}
