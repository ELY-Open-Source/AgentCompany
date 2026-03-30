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
    case "requisition": return "bg-warning-muted text-warning";
    case "pending_approval": return "bg-warning-muted text-warning";
    case "approved": return "bg-success-muted text-success";
    case "onboarding": return "bg-accent text-primary";
    case "active": return "bg-success-muted text-success";
    case "rejected": return "bg-destructive-muted text-destructive";
  }
}

export const STAGE_ORDER: HiringStage[] = ["requisition", "pending_approval", "approved", "onboarding", "active", "rejected"];
