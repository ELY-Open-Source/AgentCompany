import type { ProfileSnapshot, TaskRecord } from "@shared/types"
import { useT } from "../../i18n"
import { formatMoney } from "../../lib/formatters"
import { ActionButton } from "../ui"
import { Robot, ShieldCheck, Warning } from "../ui/icons"

export function TaskInspectorGovernance({
  task, assignee, reviewer, onCreateApproval, creatingApproval,
}: {
  task: TaskRecord
  assignee: ProfileSnapshot["agents"][number] | null
  reviewer: ProfileSnapshot["agents"][number] | null
  onCreateApproval: () => Promise<void>
  creatingApproval: boolean
}) {
  const t = useT()
  const budgetRatio = assignee && assignee.budgetMonthlyUsd > 0 ? assignee.spentMonthlyUsd / assignee.budgetMonthlyUsd : 0
  const budgetWarn = budgetRatio > 0.8
  const needsGovernance = task.status === "blocked" || (task.status === "in_review" && !reviewer)
  const inReviewWithReviewer = task.status === "in_review" && reviewer
  const anything = budgetWarn || needsGovernance || inReviewWithReviewer

  if (!anything) {
    return <div className="text-[13px] text-muted-foreground">{t("exec.noGovernanceSignals", "No governance signals.")}</div>
  }

  return (
    <div className="space-y-3">
      {budgetWarn && assignee ? (
        <div className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-[13px] font-medium ${
          budgetRatio > 1 ? "border-[color:var(--destructive)] bg-destructive-muted text-destructive" : "border-[color:var(--destructive)] bg-warning-muted text-warning"
        }`}>
          <Warning size={16} weight="fill" />
          {assignee.name} {t("exec.budgetUsed").replace("{0}", String(Math.round(budgetRatio * 100)))}
          ({formatMoney(assignee.spentMonthlyUsd)} / {formatMoney(assignee.budgetMonthlyUsd)})
        </div>
      ) : null}

      {inReviewWithReviewer ? (
        <div className="rounded-lg border border-[color:var(--primary)] bg-accent px-4 py-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-primary">
            <Robot size={16} weight="fill" />
            {t("exec.beingReviewedBy").replace("{0}", reviewer.name + (reviewer.title ? ` (${reviewer.title})` : ""))}
          </div>
          <div className="mt-1 text-[13px] leading-relaxed text-primary">
            {t("exec.submittedForReview").replace("{0}", assignee?.name ?? "").replace("{1}", reviewer.name)}
          </div>
        </div>
      ) : null}

      {needsGovernance ? (
        <div className="rounded-lg border border-[color:var(--destructive)] bg-warning-muted px-4 py-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-warning">
            <ShieldCheck size={16} weight="fill" />
            {task.status === "blocked" ? t("exec.governanceRequired") : t("exec.waitingOnReview")}
          </div>
          <div className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {task.status === "blocked" ? t("exec.blockedGovernance") : t("exec.reviewGovernance")}
          </div>
          <div className="mt-3">
            <ActionButton
              label={task.status === "blocked" ? t("exec.createUnblockApproval") : t("exec.createReviewApproval")}
              onClick={() => void onCreateApproval()}
              icon={ShieldCheck}
              loading={creatingApproval}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
