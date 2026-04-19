import { Robot } from "../ui/icons"
import type { AgentRecord, ApprovalRecord, TaskRecord } from "@shared/types"
import { useT, type TranslationFn } from "../../i18n"
import { EmptyState, ListFrame } from "../ui"

interface PendingReviewListProps {
  tasks: TaskRecord[]
  agents: AgentRecord[]
  approvals: ApprovalRecord[]
}

type ReviewKind = "board" | "user" | "manager"

interface ReviewRow {
  task: TaskRecord
  assignee: AgentRecord | null
  reviewer: AgentRecord | null
  kind: ReviewKind
}

function classifyReview(
  task: TaskRecord,
  agents: AgentRecord[],
  pendingApprovalTaskIds: Set<string>,
): ReviewRow {
  const assignee = agents.find((a) => a.id === task.assigneeAgentId) ?? null
  if (pendingApprovalTaskIds.has(task.id)) {
    return { task, assignee, reviewer: null, kind: "board" }
  }
  if (task.requiresUserReview) {
    return { task, assignee, reviewer: null, kind: "user" }
  }
  if (!assignee) {
    return { task, assignee: null, reviewer: null, kind: "user" }
  }
  if (!assignee.reportsTo) {
    return { task, assignee, reviewer: null, kind: "user" }
  }
  const reviewer = agents.find((a) => a.id === assignee.reportsTo) ?? null
  return { task, assignee, reviewer, kind: "manager" }
}

function groupTitle(kind: ReviewKind, t: TranslationFn): string {
  if (kind === "board") return t("exec.reviewGroupBoard")
  if (kind === "user") return t("exec.reviewGroupUser")
  return t("exec.reviewGroupManager")
}

function renderReviewerLine(row: ReviewRow, t: TranslationFn): React.ReactNode {
  const assigneeName = row.assignee?.name ?? "Unassigned"
  if (row.kind === "board") {
    return (
      <>
        {assigneeName} · <span className="text-warning">{t("exec.reviewAwaitsBoard")}</span>
      </>
    )
  }
  if (row.kind === "user") {
    return (
      <>
        {assigneeName} · <span className="text-warning">{t("exec.reviewAwaitsUser")}</span>
      </>
    )
  }
  const reviewer = row.reviewer
  if (!reviewer) {
    return <>{assigneeName} · {t("exec.awaitingReview")}</>
  }
  return (
    <>
      {assigneeName} &rarr; {t("exec.reviewedBy")}{" "}
      <span className="text-muted-foreground">
        {reviewer.name}
        {reviewer.title ? ` (${reviewer.title})` : ""}
      </span>
    </>
  )
}

function ReviewGroup({ title, rows, t }: { title: string; rows: ReviewRow[]; t: TranslationFn }) {
  return (
    <div>
      <div className="px-4 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {rows.map((row) => (
        <div key={row.task.id} className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0">
          <Robot size={16} weight="fill" className="mt-0.5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-foreground">{row.task.title}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{renderReviewerLine(row, t)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Pending reviews separated into three visually distinct groups so
 * Board / Human / Manager review semantics do not collapse into one
 * faceless list. Priority order (board > user > manager) lines up
 * with who is actually being asked to act next.
 */
export function PendingReviewList({ tasks, agents, approvals }: PendingReviewListProps) {
  const t = useT()
  const reviewTasks = tasks.filter((tk) => tk.status === "in_review")
  if (reviewTasks.length === 0) {
    return <EmptyState title={t("exec.noReviewsInProgress")} detail={t("exec.noReviewsDetail")} />
  }
  const pendingApprovalTaskIds = new Set(
    approvals
      .filter((approval) => approval.state === "pending" || approval.state === "revision_requested")
      .map((approval) => approval.relatedTaskId)
      .filter((taskId): taskId is string => Boolean(taskId)),
  )

  const rows = reviewTasks.map((task) => classifyReview(task, agents, pendingApprovalTaskIds))
  const boardRows = rows.filter((r) => r.kind === "board")
  const userRows = rows.filter((r) => r.kind === "user")
  const managerRows = rows.filter((r) => r.kind === "manager")

  return (
    <ListFrame>
      {boardRows.length > 0 ? <ReviewGroup title={t("exec.reviewGroupBoard")} rows={boardRows} t={t} /> : null}
      {userRows.length > 0 ? <ReviewGroup title={groupTitle("user", t)} rows={userRows} t={t} /> : null}
      {managerRows.length > 0 ? <ReviewGroup title={groupTitle("manager", t)} rows={managerRows} t={t} /> : null}
    </ListFrame>
  )
}
