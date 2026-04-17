import { Briefcase, Robot } from "../../ui/icons"
import type { AgentRecord, ApprovalRecord, TaskRecord } from "@shared/types"
import { formatTime } from "../../../lib/formatters"
import { StatusPill } from "../../ui"
import { TypeBadge } from "./TypeBadge"

export function ApprovalSummary({
  approval,
  requestingAgent,
  relatedTask,
}: {
  approval: ApprovalRecord
  requestingAgent: AgentRecord | null
  relatedTask: TaskRecord | null
}) {
  return (
    <>
      <div className="flex items-center gap-3">
        <TypeBadge type={approval.type} />
        <StatusPill status={approval.state} />
      </div>
      <div className="text-[13px] font-medium text-foreground">{approval.payloadSummary}</div>
      {approval.impactSummary ? (
        <div className="text-[13px] text-muted-foreground">{approval.impactSummary}</div>
      ) : null}
      <div className="grid gap-2 text-[13px] md:grid-cols-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Robot size={14} />
          Requested by:{" "}
          <span className="font-medium text-foreground">{requestingAgent?.name ?? "Unknown"}</span>
          {requestingAgent?.role ? (
            <span className="text-[10px] text-muted-foreground">({requestingAgent.role})</span>
          ) : null}
        </div>
        {relatedTask ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Briefcase size={14} />
            Task: <span className="font-medium text-foreground">{relatedTask.title}</span>
          </div>
        ) : null}
        <div className="text-muted-foreground">
          Created: <span className="font-mono text-foreground">{formatTime(approval.createdAt)}</span>
        </div>
        {approval.updatedAt !== approval.createdAt ? (
          <div className="text-muted-foreground">
            Updated: <span className="font-mono text-foreground">{formatTime(approval.updatedAt)}</span>
          </div>
        ) : null}
      </div>
    </>
  )
}
