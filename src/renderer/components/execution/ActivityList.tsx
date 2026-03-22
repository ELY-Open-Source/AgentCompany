import { useMemo, useState } from "react"
import { ArrowRight, Lightning, MagnifyingGlass } from "@phosphor-icons/react"
import type { ActivityRecord } from "@shared/types"
import { useT } from "../../i18n"
import { formatTime } from "../../lib/formatters"
import { ActionButton, EmptyState, ListFrame, ListRow, Select } from "../ui"
import { ENTITY_ICONS, ENTITY_TYPE_OPTIONS } from "./execution-utils"

export function ActivityList({ activity }: { activity: ActivityRecord[] }) {
  const t = useT()
  const [search, setSearch] = useState(""); const [entityFilter, setEntityFilter] = useState<string>("all"); const [visibleCount, setVisibleCount] = useState(100)
  const filtered = useMemo(() => {
    let result = activity
    if (entityFilter !== "all") result = result.filter((e) => e.entityType === entityFilter)
    if (search.trim()) { const q = search.toLowerCase(); result = result.filter((e) => e.action.toLowerCase().includes(q) || e.actor.toLowerCase().includes(q) || e.detail.toLowerCase().includes(q) || e.entityType.toLowerCase().includes(q)) }
    return result
  }, [activity, entityFilter, search])
  const visible = filtered.slice(0, visibleCount)

  if (activity.length === 0) return <EmptyState title={t("exec.noActivityYet")} />
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--muted)]" />
          <input type="text" className="focus-ring w-full rounded-[8px] border border-[color:var(--line)] bg-[color:var(--panel)] py-2.5 pl-8 pr-3.5 text-[13px] text-[color:var(--text)] placeholder:text-[color:var(--muted)]" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("exec.searchActivity")} />
        </div>
        <Select value={entityFilter} onChange={setEntityFilter} options={ENTITY_TYPE_OPTIONS.map((v) => ({ value: v, label: v === "all" ? t("exec.allTypes") : v }))} />
      </div>
      {visible.length === 0 ? <EmptyState title={t("exec.noMatchingActivity")} /> : (
        <>
          <ListFrame>
            {visible.map((entry) => {
              const EntityIcon = ENTITY_ICONS[entry.entityType] ?? Lightning
              return (
                <ListRow key={entry.id}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2"><EntityIcon size={14} weight="duotone" className="text-[color:var(--muted)]" /><div className="text-[14px] text-[color:var(--text)]">{entry.action}</div></div>
                    <div className="mono text-[11px] text-[color:var(--muted)]">{formatTime(entry.createdAt)}</div>
                  </div>
                  <div className="flex items-center gap-2 text-[13px] text-[color:var(--muted)]"><span className="font-medium text-[color:var(--muted-strong)]">{entry.actor}</span><span>·</span><span>{entry.detail || `${entry.entityType}:${entry.entityId}`}</span></div>
                </ListRow>
              )
            })}
          </ListFrame>
          {visibleCount < filtered.length ? <div className="flex justify-center pt-2"><ActionButton label={`Load more (${filtered.length - visibleCount} remaining)`} onClick={() => setVisibleCount((c) => c + 100)} icon={ArrowRight} /></div> : null}
        </>
      )}
    </div>
  )
}
