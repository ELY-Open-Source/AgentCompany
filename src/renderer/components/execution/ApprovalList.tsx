import { useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import type { ApprovalRecord } from "@shared/types"
import { useT } from "../../i18n"
import { useRovingTabIndex } from "../../lib/keyboard"
import { EmptyState, StatusPill } from "../ui"

export function ApprovalList({ approvals, selectedApprovalId, onSelect }: { approvals: ApprovalRecord[]; selectedApprovalId: string | null; onSelect: (id: string) => void }) {
  const t = useT()
  const parentRef = useRef<HTMLDivElement>(null)
  const { handleKeyDown, getTabIndex, focusedIndex } = useRovingTabIndex(approvals.length)

  const virtualizer = useVirtualizer({
    count: approvals.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 10,
  })

  if (approvals.length === 0) return <EmptyState title={t("exec.noApprovals")} detail={t("exec.noApprovalsDetail")} />
  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto border-y border-[color:var(--line)]"
      role="listbox"
      aria-label="Pending approvals"
      onKeyDown={handleKeyDown}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const approval = approvals[virtualRow.index]
          return (
            <div
              key={approval.id}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              tabIndex={getTabIndex(virtualRow.index)}
              role="option"
              aria-selected={approval.id === selectedApprovalId}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className={`focus-ring outline-none ${virtualRow.index === focusedIndex ? "ring-1 ring-[color:var(--accent)] ring-inset" : ""}`}
            >
              <button
                className={`relative w-full border-b border-[color:var(--line)] px-4 py-3 text-left transition duration-150 last:border-b-0 ${selectedApprovalId === approval.id ? "bg-[color:var(--warn-soft)]" : "bg-transparent hover:bg-[color:var(--panel-soft)]"}`}
                onClick={() => onSelect(approval.id)}
                tabIndex={-1}
              >
                {selectedApprovalId === approval.id ? <span className="absolute inset-y-0 left-0 w-[3px] bg-[color:var(--warn)]" /> : null}
                <div className="flex items-center justify-between gap-4">
                  <div className={`truncate text-[13px] text-[color:var(--text)] ${selectedApprovalId === approval.id ? "font-semibold" : "font-medium"}`}>{approval.payloadSummary}</div>
                  <StatusPill status={approval.state} />
                </div>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
