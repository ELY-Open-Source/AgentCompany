import { Warning } from "@phosphor-icons/react"
import type { ProfileSnapshot } from "@shared/types"
import { formatMoney } from "../../lib/formatters"
import { ListFrame, ListRow } from "../ui"

export function BudgetSummary({ agents, costs }: { agents: ProfileSnapshot["agents"]; costs: ProfileSnapshot["costs"] }) {
  const knownSpend = costs.reduce((sum, entry) => sum + (entry.amountUsd ?? 0), 0)
  const unattributedCount = costs.filter((entry) => entry.unattributed).length
  return (
    <div className="space-y-4">
      <div className="border-y border-[color:var(--line)]">
        <div className="flex items-end justify-between gap-4 py-3">
          <div className="text-[12px] text-[color:var(--muted)]">Known spend</div>
          <div className="mono text-[22px] tracking-[-0.03em] text-[color:var(--text)]">{formatMoney(knownSpend)}</div>
        </div>
        <div className="flex items-end justify-between gap-4 border-t border-[color:var(--line)] py-3">
          <div className="text-[12px] text-[color:var(--muted)]">Unattributed entries</div>
          <div className="mono text-[18px] text-[color:var(--text)]">{String(unattributedCount)}</div>
        </div>
      </div>
      <ListFrame>
        {agents.map((agent) => {
          const pct = agent.budgetMonthlyUsd > 0 ? (agent.spentMonthlyUsd / agent.budgetMonthlyUsd) * 100 : 0
          const isWarning = pct > 80 && pct <= 100; const isDanger = pct > 100
          const barColor = isDanger ? "bg-[color:var(--danger)]" : isWarning ? "bg-[color:var(--warn)]" : "bg-[color:var(--success)]"
          const nameColor = isDanger ? "text-[color:var(--danger)]" : isWarning ? "text-[color:var(--warn)]" : "text-[color:var(--text)]"
          return (
            <ListRow key={agent.id}>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`text-[14px] font-medium ${nameColor}`}>{agent.name}</div>
                  {isDanger ? <Warning size={14} weight="fill" className="text-[color:var(--danger)]" /> : null}
                  {isWarning ? <Warning size={14} weight="fill" className="text-[color:var(--warn)]" /> : null}
                </div>
                <div className="flex items-center gap-2">
                  <div className="mono text-[12px] text-[color:var(--text)]">{formatMoney(agent.spentMonthlyUsd)} / {formatMoney(agent.budgetMonthlyUsd)}</div>
                  <span className={`mono text-[11px] font-semibold ${isDanger ? "text-[color:var(--danger)]" : isWarning ? "text-[color:var(--warn)]" : "text-[color:var(--muted)]"}`}>{Math.round(pct)}%</span>
                </div>
              </div>
              <div className="h-2 rounded-full bg-[color:var(--line)]"><div className={`h-2 rounded-full ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
            </ListRow>
          )
        })}
      </ListFrame>
    </div>
  )
}
