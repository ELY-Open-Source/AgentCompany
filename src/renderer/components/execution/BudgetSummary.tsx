import { useEffect, useState } from "react"
import { Warning } from "@phosphor-icons/react"
import type { BudgetStatusSummary, ProfileSnapshot } from "@shared/types"
import { formatMoney } from "../../lib/formatters"
import { ListFrame, ListRow } from "../ui"

interface BudgetSummaryProps {
  agents: ProfileSnapshot["agents"]
  costs: ProfileSnapshot["costs"]
  companyId?: string
}

export function BudgetSummary({ agents, costs, companyId }: BudgetSummaryProps) {
  const [budgetStatus, setBudgetStatus] = useState<BudgetStatusSummary | null>(null)

  useEffect(() => {
    if (!companyId) return
    void (async () => {
      const result = await window.agentCompany.getBudgetStatus(companyId)
      if (result.ok) setBudgetStatus(result.data)
    })()
  }, [companyId])

  const knownSpend = costs.reduce((sum, entry) => sum + (entry.amountUsd ?? 0), 0)
  const unattributedCount = costs.filter((entry) => entry.unattributed).length

  const hasPolicies = budgetStatus && budgetStatus.policies.length > 0

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

      {hasPolicies ? (
        <ListFrame>
          {budgetStatus.policies.map((status) => {
            const pct = status.amount > 0 ? (status.spent / status.amount) * 100 : 0
            const isWarning = pct > 80 && pct <= 100
            const isDanger = pct > 100
            const barColor = isDanger ? "bg-[color:var(--danger)]" : isWarning ? "bg-[color:var(--warn)]" : "bg-[color:var(--success)]"
            const nameColor = isDanger ? "text-[color:var(--danger)]" : isWarning ? "text-[color:var(--warn)]" : "text-[color:var(--text)]"

            const scopeLabel = status.scopeType === "company"
              ? "Company"
              : status.scopeType === "agent"
                ? (agents.find((a) => a.id === status.scopeId)?.name ?? status.scopeId.slice(0, 8))
                : status.scopeId.slice(0, 8)

            return (
              <ListRow key={status.policyId}>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-[color:var(--panel-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-strong)]">
                      {status.scopeType}
                    </span>
                    <div className={`text-[14px] font-medium ${nameColor}`}>{scopeLabel}</div>
                    {status.hasOpenIncident ? <Warning size={14} weight="fill" className="text-[color:var(--warn)]" /> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="mono text-[12px] text-[color:var(--text)]">{formatMoney(status.spent / 100)} / {formatMoney(status.amount / 100)}</div>
                    <span className={`mono text-[11px] font-semibold ${isDanger ? "text-[color:var(--danger)]" : isWarning ? "text-[color:var(--warn)]" : "text-[color:var(--muted)]"}`}>{Math.round(pct)}%</span>
                  </div>
                </div>
                <div className="h-2 rounded-full bg-[color:var(--line)]"><div className={`h-2 rounded-full ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
              </ListRow>
            )
          })}
        </ListFrame>
      ) : (
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
      )}
    </div>
  )
}
