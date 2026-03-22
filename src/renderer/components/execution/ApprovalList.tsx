import type { ApprovalRecord } from "@shared/types"
import { useT } from "../../i18n"
import { EmptyState, ListFrame, StatusPill } from "../ui"

export function ApprovalList({ approvals, selectedApprovalId, onSelect }: { approvals: ApprovalRecord[]; selectedApprovalId: string | null; onSelect: (id: string) => void }) {
  const t = useT()
  if (approvals.length === 0) return <EmptyState title={t("exec.noApprovals")} />
  return (
    <ListFrame>
      {approvals.map((approval) => (
        <button key={approval.id} className={`focus-ring relative w-full border-b border-[color:var(--line)] px-5 py-4 text-left transition last:border-b-0 ${selectedApprovalId === approval.id ? "bg-transparent" : "bg-transparent hover:bg-[color:var(--panel-soft)]"}`} onClick={() => onSelect(approval.id)}>
          {selectedApprovalId === approval.id ? <span className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-[color:var(--warn)]" /> : null}
          <div className="flex items-center justify-between gap-4">
            <div className={`text-[15px] text-[color:var(--text)] ${selectedApprovalId === approval.id ? "font-semibold" : "font-medium"}`}>{approval.payloadSummary}</div>
            <StatusPill status={approval.state} />
          </div>
        </button>
      ))}
    </ListFrame>
  )
}
