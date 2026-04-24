import { approvalTypeEnum, type ApprovalType, type ExecutionMode } from "@shared/types";

export type ApprovalPolicyScope = "requester_or_task" | "related_agent";
export type ApprovalPolicyRequiredMode = "any" | ExecutionMode;

export interface ApprovalPolicyDefinition {
  approvalType: ApprovalType;
  scopeType: ApprovalPolicyScope;
  blocksExecution: boolean;
  requiredMode: ApprovalPolicyRequiredMode;
  autoApprovable: boolean;
}

const DEFAULT_POLICY: Omit<ApprovalPolicyDefinition, "approvalType"> = {
  scopeType: "requester_or_task",
  blocksExecution: false,
  requiredMode: "any",
  autoApprovable: false,
};

const POLICY_OVERRIDES: Record<ApprovalType, Partial<Omit<ApprovalPolicyDefinition, "approvalType">>> = {
  hire_agent: {
    scopeType: "related_agent",
    blocksExecution: true,
    autoApprovable: true,
  },
  approve_ceo_strategy: {
    blocksExecution: true,
    requiredMode: "ai_cofounder",
    autoApprovable: true,
  },
  dangerous_command: {
    blocksExecution: true,
  },
  secret_access: {
    blocksExecution: true,
  },
  budget_request: {},
  promotion: {},
  termination: {},
  vendor_approval: {},
  document_review: {
    blocksExecution: true,
    requiredMode: "ai_cofounder",
  },
  production_deploy: {
    blocksExecution: true,
  },
  incident_escalation: {},
  social_post: {
    blocksExecution: true,
  },
  deliverable_review: {
    blocksExecution: true,
    requiredMode: "ai_cofounder",
  },
  budget_override: {
    blocksExecution: true,
  },
  plan_review: {
    blocksExecution: true,
    requiredMode: "ai_cofounder",
  },
  scope_review: {
    blocksExecution: true,
    requiredMode: "ai_cofounder",
  },
  draft_review: {
    blocksExecution: true,
    requiredMode: "ai_cofounder",
  },
  strategy_review: {
    blocksExecution: true,
    requiredMode: "ai_cofounder",
  },
  exception_review: {
    blocksExecution: true,
    requiredMode: "ai_cofounder",
  },
};

export const APPROVAL_POLICY_SEED: readonly ApprovalPolicyDefinition[] = approvalTypeEnum.options.map((approvalType) => ({
  approvalType,
  ...DEFAULT_POLICY,
  ...POLICY_OVERRIDES[approvalType],
}));

export const COFOUNDER_MANDATORY_APPROVAL_TYPES: readonly ApprovalType[] = APPROVAL_POLICY_SEED
  .filter((policy) => policy.blocksExecution && policy.requiredMode === "ai_cofounder")
  .map((policy) => policy.approvalType);

export const OPERATIONAL_APPROVAL_TYPES: readonly ApprovalType[] = APPROVAL_POLICY_SEED
  .filter((policy) =>
    policy.blocksExecution &&
    policy.requiredMode === "any" &&
    policy.scopeType === "requester_or_task")
  .map((policy) => policy.approvalType);
