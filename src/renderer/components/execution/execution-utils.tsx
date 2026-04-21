import type { ProfileSnapshot, TaskRecord } from "@shared/types"
import {
  Robot, CheckSquare, Play, ShieldCheck, Gear, FolderOpen, Key, Target, Briefcase, Buildings,
} from "../ui/icons"

export function describeActionError(error: unknown) {
  return error instanceof Error ? error.message : "The action could not be completed."
}

export type GovernanceAlertKind = "blocked" | "budget_over" | "missing_reviewer"
export type GovernanceAlertSeverity = "warning" | "danger"
export interface GovernanceAlert {
  kind: GovernanceAlertKind
  severity: GovernanceAlertSeverity
}

type Agent = ProfileSnapshot["agents"][number]

/**
 * Collect the governance signals the user should see the moment a task opens.
 * Returned alerts drive the banner at the top of Overview and the badge on
 * the Governance tab; the tab itself still renders the full narrative + action.
 */
export function shouldAlertGovernance(
  task: TaskRecord,
  assignee?: Agent | null,
  reviewer?: Agent | null,
): GovernanceAlert[] {
  const alerts: GovernanceAlert[] = []

  if (task.status === "blocked") {
    alerts.push({ kind: "blocked", severity: "danger" })
  }

  if (assignee && assignee.budgetMonthlyUsd > 0) {
    const ratio = assignee.spentMonthlyUsd / assignee.budgetMonthlyUsd
    if (ratio > 0.8) {
      alerts.push({ kind: "budget_over", severity: ratio > 1 ? "danger" : "warning" })
    }
  }

  if (task.status === "in_review" && !reviewer) {
    alerts.push({ kind: "missing_reviewer", severity: "warning" })
  }

  return alerts
}

export const ENTITY_ICONS: Record<string, typeof Robot> = {
  agent: Robot, task: CheckSquare, run: Play, approval: ShieldCheck, connector: Gear,
  workspace: FolderOpen, secret: Key, goal: Target, project: Briefcase, company: Buildings,
}

export const ENTITY_TYPE_OPTIONS = [
  "all", "agent", "task", "run", "approval", "connector", "workspace", "secret", "goal", "project", "company",
] as const

export function WorkspaceStatePill({ state }: { state: string }) {
  const colorMap: Record<string, string> = {
    ready: "text-success bg-success-muted",
    busy: "text-warning bg-warning-muted",
    blocked: "text-destructive bg-destructive-muted",
    missing: "text-muted-foreground bg-muted",
    error: "text-destructive bg-destructive-muted",
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${colorMap[state] ?? colorMap.missing}`}>
      {state}
    </span>
  )
}

export function PriorityDot({ priority }: { priority: string }) {
  const color = priority === "critical" ? "bg-destructive" : priority === "high" ? "bg-warning" : priority === "low" ? "bg-[color:var(--muted-foreground)]" : "bg-[color:var(--muted-foreground)]"
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} aria-label={`${priority} priority`} />
}
