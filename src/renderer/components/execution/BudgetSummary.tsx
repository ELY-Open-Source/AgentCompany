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
      <div className="border-y border-border">
        <div className="flex items-end justify-between gap-4 py-3">
          <div className="text-[12px] text-muted-foreground">Known spend</div>
          <div className="font-mono text-[22px] tracking-[-0.03em] text-foreground">{formatMoney(knownSpend)}</div>
        </div>
        <div className="flex items-end justify-between gap-4 border-t border-border py-3">
          <div className="text-[12px] text-muted-foreground">Unattributed entries</div>
          <div className="font-mono text-[18px] text-foreground">{String(unattributedCount)}</div>
        </div>
      </div>

      {hasPolicies ? (
        <ListFrame>
          {budgetStatus.policies.map((status) => {
            const pct = status.amount > 0 ? (status.spent / status.amount) * 100 : 0
            const isWarning = pct > 80 && pct <= 100
            const isDanger = pct > 100
            const barColor = isDanger ? "bg-destructive" : isWarning ? "bg-yellow-600 dark:bg-yellow-400" : "bg-green-600 dark:bg-green-400"
            const nameColor = isDanger ? "text-destructive" : isWarning ? "text-yellow-600 dark:text-yellow-400" : "text-foreground"

            const scopeLabel = status.scopeType === "company"
              ? "Company"
              : status.scopeType === "agent"
                ? (agents.find((a) => a.id === status.scopeId)?.name ?? status.scopeId.slice(0, 8))
                : status.scopeId.slice(0, 8)

            return (
              <ListRow key={status.policyId}>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                      {status.scopeType}
                    </span>
                    <div className={`text-[14px] font-medium ${nameColor}`}>{scopeLabel}</div>
                    {status.hasOpenIncident ? <Warning size={14} weight="fill" className="text-yellow-600 dark:text-yellow-400" /> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="font-mono text-[12px] text-foreground">{formatMoney(status.spent / 100)} / {formatMoney(status.amount / 100)}</div>
                    <span className={`font-mono text-[11px] font-semibold ${isDanger ? "text-destructive" : isWarning ? "text-yellow-600 dark:text-yellow-400" : "text-muted-foreground"}`}>{Math.round(pct)}%</span>
                  </div>
                </div>
                <div className="h-2 rounded-full bg-[color:var(--border)]"><div className={`h-2 rounded-full ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
              </ListRow>
            )
          })}
        </ListFrame>
      ) : (
        <ListFrame>
          {agents.map((agent) => {
            const pct = agent.budgetMonthlyUsd > 0 ? (agent.spentMonthlyUsd / agent.budgetMonthlyUsd) * 100 : 0
            const isWarning = pct > 80 && pct <= 100; const isDanger = pct > 100
            const barColor = isDanger ? "bg-destructive" : isWarning ? "bg-yellow-600 dark:bg-yellow-400" : "bg-green-600 dark:bg-green-400"
            const nameColor = isDanger ? "text-destructive" : isWarning ? "text-yellow-600 dark:text-yellow-400" : "text-foreground"
            return (
              <ListRow key={agent.id}>
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`text-[14px] font-medium ${nameColor}`}>{agent.name}</div>
                    {isDanger ? <Warning size={14} weight="fill" className="text-destructive" /> : null}
                    {isWarning ? <Warning size={14} weight="fill" className="text-yellow-600 dark:text-yellow-400" /> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="font-mono text-[12px] text-foreground">{formatMoney(agent.spentMonthlyUsd)} / {formatMoney(agent.budgetMonthlyUsd)}</div>
                    <span className={`font-mono text-[11px] font-semibold ${isDanger ? "text-destructive" : isWarning ? "text-yellow-600 dark:text-yellow-400" : "text-muted-foreground"}`}>{Math.round(pct)}%</span>
                  </div>
                </div>
                <div className="h-2 rounded-full bg-[color:var(--border)]"><div className={`h-2 rounded-full ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} /></div>
              </ListRow>
            )
          })}
        </ListFrame>
      )}
    </div>
  )
}
