import { useMemo } from "react"
import type { AgentRecord, ApprovalRecord } from "@shared/types"
import { formatMoney } from "../../../lib/formatters"
import { Card, Eyebrow } from "../../ui"
import { useT } from "../../../i18n"
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
  const t = useT()
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

  const name = proposedAgent?.name ?? reqSnap?.name ?? t("approval.proposedUnspecified")
  const role = proposedAgent?.role ?? reqSnap?.role ?? t("approval.proposedUnspecified")
  const title = proposedAgent?.title || reqSnap?.title
  const capabilities = proposedAgent?.capabilities || reqSnap?.capabilities
  const connectorId = proposedAgent?.connectorId ?? reqSnap?.connectorId ?? t("approval.proposedUnknown")
  const budget = proposedAgent?.budgetMonthlyUsd ?? reqSnap?.budgetMonthlyUsd ?? 0

  return (
    <Card padding="sm" className="border-[color:var(--primary)] border-opacity-30 bg-accent">
      <Eyebrow tone="primary" className="mb-2">{t("approval.proposedHire")}</Eyebrow>
      <div className="grid gap-1.5 text-[12px]">
        <div>
          <span className="text-muted-foreground">{t("approval.proposedName")}</span>{" "}
          <span className="font-medium text-foreground">{name}</span>
        </div>
        <div>
          <span className="text-muted-foreground">{t("approval.proposedRole")}</span>{" "}
          <span className="text-foreground">{role}</span>
        </div>
        {title ? (
          <div>
            <span className="text-muted-foreground">{t("approval.proposedTitle")}</span>{" "}
            <span className="text-foreground">{title}</span>
          </div>
        ) : null}
        {capabilities ? (
          <div>
            <span className="text-muted-foreground">{t("approval.proposedCapabilities")}</span>{" "}
            <span className="text-foreground">{capabilities}</span>
          </div>
        ) : null}
        <div>
          <span className="text-muted-foreground">{t("approval.proposedConnector")}</span>{" "}
          <span className="font-mono text-foreground">{connectorId}</span>
        </div>
        <div>
          <span className="text-muted-foreground">{t("approval.proposedBudget")}</span>{" "}
          <span className="font-mono text-foreground">{formatMoney(budget)}{t("approval.budgetSuffix")}</span>
        </div>
        {mgr ? (
          <div>
            <span className="text-muted-foreground">{t("approval.proposedReportsTo")}</span>{" "}
            <span className="text-foreground">{mgr.name}</span>
          </div>
        ) : null}
      </div>
    </Card>
  )
}
