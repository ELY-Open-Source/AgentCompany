import type { ApprovalRecord } from "@shared/types"
import {
  Robot, CheckSquare, Play, ShieldCheck, Gear, FolderOpen, Key, Target, Briefcase, Buildings,
} from "@phosphor-icons/react"

export function describeActionError(error: unknown) {
  return error instanceof Error ? error.message : "The action could not be completed."
}

export function parseApprovalPayloadJson(approval: ApprovalRecord): Record<string, unknown> | null {
  if (!approval.payloadJson) return null
  try {
    const parsed = JSON.parse(approval.payloadJson)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch { return null }
  return null
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
    ready: "text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/50",
    busy: "text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/50",
    blocked: "text-destructive bg-red-100 dark:bg-red-900/50",
    missing: "text-muted-foreground bg-muted",
    error: "text-destructive bg-red-100 dark:bg-red-900/50",
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${colorMap[state] ?? colorMap.missing}`}>
      {state}
    </span>
  )
}

export function PriorityDot({ priority }: { priority: string }) {
  const color = priority === "critical" ? "bg-destructive" : priority === "high" ? "bg-yellow-600 dark:bg-yellow-400" : priority === "low" ? "bg-[color:var(--muted-foreground)]" : "bg-[color:var(--muted-foreground)]"
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} aria-label={`${priority} priority`} />
}
