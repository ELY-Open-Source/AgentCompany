import type { AgentRecord, ApprovalRecord } from "@shared/types";

export type HiringStage = "requisition" | "pending_approval" | "approved" | "onboarding" | "active" | "rejected";

export interface HiringCandidate {
  agent: AgentRecord | null;
  approval: ApprovalRecord | null;
  stage: HiringStage;
}

export function getHiringStage(agent: AgentRecord, approval: ApprovalRecord | null): HiringStage {
  if (agent.status === "pending_approval") {
    if (!approval) return "requisition";
    if (approval.state === "pending") return "pending_approval";
    if (approval.state === "rejected") return "rejected";
    if (approval.state === "revision_requested") return "requisition";
    return "approved";
  }
  if (agent.status === "idle" && approval?.state === "approved") {
    return "onboarding";
  }
  return "active";
}

export function stageColor(stage: HiringStage): string {
  switch (stage) {
    case "requisition": return "bg-[color:var(--warn-soft)] text-[color:var(--warn)]";
    case "pending_approval": return "bg-[color:var(--warn-soft)] text-[color:var(--warn)]";
    case "approved": return "bg-[color:var(--success-soft)] text-[color:var(--success)]";
    case "onboarding": return "bg-[color:var(--accent-soft)] text-[color:var(--accent)]";
    case "active": return "bg-[color:var(--success-soft)] text-[color:var(--success)]";
    case "rejected": return "bg-[color:var(--danger-soft)] text-[color:var(--danger)]";
  }
}

export const STAGE_ORDER: HiringStage[] = ["requisition", "pending_approval", "approved", "onboarding", "active", "rejected"];
