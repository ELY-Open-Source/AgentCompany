import { useMemo } from "react"
import type { AgentRecord, ApprovalRecord } from "@shared/types"
import { formatMoney } from "../../../lib/formatters"
import { useApprovalPayload } from "./useApprovalPayload"

interface HireSnapshot {
  name?: string
  role?: string
  title?: string
  capabilities?: string
  connectorId?: string
  budgetMonthlyUsd?: number
  reportsTo?: string
}

function toHireSnapshot(value: unknown): HireSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as HireSnapshot
}

export function ProposedHireCard({
  approval,
  agents,
}: {
  approval: ApprovalRecord
  agents: AgentRecord[]
}) {
  const payload = useApprovalPayload(approval)

  const { proposedAgent, reqSnap, mgr } = useMemo(() => {
    const payloadAgentId = typeof payload?.agentId === "string" ? payload.agentId : null
    const snapshot = toHireSnapshot(payload?.requestedConfigurationSnapshot)
    const relatedAgent = approval.relatedAgentId
      ? agents.find((a) => a.id === approval.relatedAgentId) ?? null
      : null
    const fallbackAgent = payloadAgentId ? agents.find((a) => a.id === payloadAgentId) ?? null : null
    const proposed = relatedAgent ?? fallbackAgent
    const mgrId = proposed?.reportsTo ?? snapshot?.reportsTo ?? null
    const manager = mgrId ? agents.find((a) => a.id === mgrId) ?? null : null
    return { proposedAgent: proposed, reqSnap: snapshot, mgr: manager }
  }, [payload, approval.relatedAgentId, agents])

  if (!proposedAgent && !reqSnap) return null

  const name = proposedAgent?.name ?? reqSnap?.name ?? "Unspecified"
  const role = proposedAgent?.role ?? reqSnap?.role ?? "Unspecified"
  const title = proposedAgent?.title || reqSnap?.title
  const capabilities = proposedAgent?.capabilities || reqSnap?.capabilities
  const connectorId = proposedAgent?.connectorId ?? reqSnap?.connectorId ?? "Unknown"
  const budget = proposedAgent?.budgetMonthlyUsd ?? reqSnap?.budgetMonthlyUsd ?? 0

  return (
    <div className="rounded-lg border border-[color:var(--primary)] border-opacity-30 bg-accent px-4 py-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">Proposed Hire</div>
      <div className="grid gap-1.5 text-[12px]">
        <div>
          <span className="text-muted-foreground">Name:</span>{" "}
          <span className="font-medium text-foreground">{name}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Role:</span>{" "}
          <span className="text-foreground">{role}</span>
        </div>
        {title ? (
          <div>
            <span className="text-muted-foreground">Title:</span>{" "}
            <span className="text-foreground">{title}</span>
          </div>
        ) : null}
        {capabilities ? (
          <div>
            <span className="text-muted-foreground">Capabilities:</span>{" "}
            <span className="text-foreground">{capabilities}</span>
          </div>
        ) : null}
        <div>
          <span className="text-muted-foreground">Connector:</span>{" "}
          <span className="font-mono text-foreground">{connectorId}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Budget:</span>{" "}
          <span className="font-mono text-foreground">{formatMoney(budget)}/mo</span>
        </div>
        {mgr ? (
          <div>
            <span className="text-muted-foreground">Reports to:</span>{" "}
            <span className="text-foreground">{mgr.name}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
