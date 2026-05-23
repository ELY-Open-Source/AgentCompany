type ValueOf<T> = T[keyof T];

export const SDLC_REVIEW_AGENT_KEY = {
  CODE_REVIEWER: "code_reviewer",
  MIGRATION_REVIEWER: "migration_reviewer",
  POLICY_REVIEWER: "policy_reviewer",
} as const;

export const SDLC_REVIEW_TARGET_TYPE = { WORKSPACE: "workspace", MIGRATION: "migration", POLICY: "policy" } as const;
export const EVAL_SUITE_KEY = { CONTRACT: "contract", INTEGRATION: "integration", REPLAY: "replay" } as const;
export const SDLC_RUN_STATE = { PASSED: "passed", FAILED: "failed" } as const;
export const PR_BOT_GATE_KEY = {
  STATIC_CHECKS: "static_checks",
  MIGRATION_DIFF: "migration_diff",
  POLICY_DIFF: "policy_diff",
  HUMAN_APPROVAL: "human_approval",
} as const;

export type SdlcReviewAgentKey = ValueOf<typeof SDLC_REVIEW_AGENT_KEY>;
export type SdlcReviewTargetType = ValueOf<typeof SDLC_REVIEW_TARGET_TYPE>;
export type EvalSuiteKey = ValueOf<typeof EVAL_SUITE_KEY>;
export type SdlcRunState = ValueOf<typeof SDLC_RUN_STATE>;
export type PrBotGateKey = ValueOf<typeof PR_BOT_GATE_KEY>;

export interface SdlcReviewAgentRecord {
  id: string; orgId: string; key: SdlcReviewAgentKey; label: string; specialty: string; enabled: boolean; createdAt: string; updatedAt: string;
}

export interface SdlcReviewRunRecord {
  id: string; orgId: string; reviewAgentId: string; targetType: SdlcReviewTargetType; targetRef: string;
  state: SdlcRunState; resultJson: string; createdAt: string; completedAt: string;
}

export interface EvalSuiteRecord {
  id: string; orgId: string; key: EvalSuiteKey; label: string; scope: string; createdAt: string; updatedAt: string;
}

export interface EvalCaseRecord {
  id: string; orgId: string; suiteId: string; title: string; sourceType: string; sourceRef: string; expectedSignal: string; createdAt: string;
}

export interface EvalRunRecord {
  id: string; orgId: string; suiteId: string; state: SdlcRunState; passedCount: number; failedCount: number; resultJson: string; createdAt: string; completedAt: string;
}

export interface PrBotGateRecord {
  id: string; orgId: string; key: PrBotGateKey; label: string; gateType: string; enabled: boolean; createdAt: string; updatedAt: string;
}
