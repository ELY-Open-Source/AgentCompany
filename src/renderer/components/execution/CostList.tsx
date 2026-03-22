import { useMemo, useState } from "react"
import type { ProfileSnapshot } from "@shared/types"
import { useT } from "../../i18n"
import { formatMoney } from "../../lib/formatters"
import { EmptyState, ListFrame, ListRow, Select } from "../ui"

export function CostList({ costs, agents, runs }: { costs: ProfileSnapshot["costs"]; agents: ProfileSnapshot["agents"]; runs: ProfileSnapshot["runs"] }) {
  const t = useT()
  const [connectorFilter, setConnectorFilter] = useState("all")
  const connectorIds = useMemo(() => { const ids = new Set(costs.map((c) => c.connectorId)); return Array.from(ids).sort() }, [costs])
  const filtered = useMemo(() => connectorFilter === "all" ? costs : costs.filter((c) => c.connectorId === connectorFilter), [costs, connectorFilter])
  const total = useMemo(() => filtered.reduce((sum, c) => sum + (c.amountUsd ?? 0), 0), [filtered])

  if (costs.length === 0) return <EmptyState title={t("exec.noCostData")} />
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3"><Select value={connectorFilter} onChange={setConnectorFilter} options={[{ value: "all", label: t("exec.allConnectors") }, ...connectorIds.map((id) => ({ value: id, label: id }))]} /></div>
      <ListFrame>
        {filtered.map((entry) => (
          <ListRow key={entry.id} className="flex items-center justify-between">
            <div>
              <div className="text-[14px] text-[color:var(--text)]">{runs.find((run) => run.id === entry.runId)?.summary || "Run cost"}</div>
              <div className="text-[12px] text-[color:var(--muted)]">{agents.find((a) => a.id === entry.agentId)?.name ?? "Unknown agent"} · {entry.connectorId}</div>
            </div>
            <div className="text-right">
              <div className="mono text-[13px] text-[color:var(--text)]">{formatMoney(entry.amountUsd)}</div>
              {entry.unattributed ? <div className="text-[11px] text-[color:var(--warn)]">unattributed</div> : null}
            </div>
          </ListRow>
        ))}
        <ListRow className="flex items-center justify-between">
          <div className="text-[14px] font-semibold text-[color:var(--text)]">Total ({filtered.length} entries)</div>
          <div className="mono text-[14px] font-semibold text-[color:var(--text)]">{formatMoney(total)}</div>
        </ListRow>
      </ListFrame>
    </div>
  )
}
