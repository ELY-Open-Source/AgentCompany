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
    ready: "text-[color:var(--success)] bg-[color:var(--success-soft)]",
    busy: "text-[color:var(--warn)] bg-[color:var(--warn-soft)]",
    blocked: "text-[color:var(--danger)] bg-[color:var(--danger-soft)]",
    missing: "text-[color:var(--muted-strong)] bg-[color:var(--panel-soft)]",
    error: "text-[color:var(--danger)] bg-[color:var(--danger-soft)]",
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${colorMap[state] ?? colorMap.missing}`}>
      {state}
    </span>
  )
}

export function PriorityDot({ priority }: { priority: string }) {
  const color = priority === "critical" ? "bg-[color:var(--danger)]" : priority === "high" ? "bg-[color:var(--warn)]" : priority === "low" ? "bg-[color:var(--muted)]" : "bg-[color:var(--muted-strong)]"
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${color}`} aria-label={`${priority} priority`} />
}
