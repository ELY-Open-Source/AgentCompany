type ValueOf<T> = T[keyof T];

export const PR_BOT_GATE_KEY = {
  STATIC_CHECKS: "static_checks",
  MIGRATION_DIFF: "migration_diff",
  POLICY_DIFF: "policy_diff",
  HUMAN_APPROVAL: "human_approval",
} as const;

export type PrBotGateKey = ValueOf<typeof PR_BOT_GATE_KEY>;

export interface PrBotGateRecord {
  id: string; orgId: string; key: PrBotGateKey; label: string; gateType: string; enabled: boolean; createdAt: string; updatedAt: string;
}
