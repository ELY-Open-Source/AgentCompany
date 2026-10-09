type ValueOf<T> = T[keyof T];

export const FEATURE_FLAG_KEY = {
  PROVIDER_BACKGROUND_EXECUTION: "provider_background_execution",
  SOCIAL_PUBLISH_APPROVAL: "social_publish_approval",
  BOARD_INTERVENTION: "board_intervention",
} as const;

export const SLO_SIGNAL_KEY = {
  PROVIDER_REQUEST_SUCCESS: "provider_request_success",
  APPROVAL_ROUTE_COVERAGE: "approval_route_coverage",
  SKILL_RESOLVE_SUCCESS: "skill_resolve_success",
  MIGRATION_VALIDATION_SUCCESS: "migration_validation_success",
} as const;

export type FeatureFlagKey = ValueOf<typeof FEATURE_FLAG_KEY>;
export type SloSignalKey = ValueOf<typeof SLO_SIGNAL_KEY>;

export interface FeatureFlagRecord {
  id: string; orgId: string; key: FeatureFlagKey; label: string; enabled: boolean; createdAt: string; updatedAt: string;
}

export interface SloTargetRecord {
  id: string; orgId: string; signalKey: SloSignalKey; label: string; targetBasisPoints: number; windowMinutes: number; createdAt: string; updatedAt: string;
}

export interface OperationalEventRecord {
  id: string; orgId: string; signalKey: SloSignalKey; source: string; success: boolean; durationMs: number | null; detailJson: string; createdAt: string;
}
