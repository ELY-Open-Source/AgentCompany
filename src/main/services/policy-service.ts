import { COMPANY_PRESETS } from "../../shared/company-presets";
import type { DatabaseSync } from "node:sqlite";
import type { RiskLevel } from "../../shared/domain";
import { RISK_LEVEL } from "../../shared/domain";
import { createId } from "../../shared/ids";

const RISK_RANK: Record<RiskLevel, number> = {
  [RISK_LEVEL.LOW]: 0,
  [RISK_LEVEL.MEDIUM]: 1,
  [RISK_LEVEL.HIGH]: 2,
};

export interface PolicyDecision {
  approvalRequired: boolean;
  matchedRuleId: string;
}

export class PolicyService {
  constructor(private readonly db: DatabaseSync) {}

  seedOrganizationPolicies(orgId: string, now: string): void {
    this.db.prepare(`
      insert into policy_rules(id, org_id, subject_type, subject_id, action, effect, risk_ceiling, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(createId("pol"), orgId, "organization", orgId, "task_create", "require_approval", COMPANY_PRESETS.taskRiskCeiling, now);
  }

  evaluateTaskCreation(orgId: string, risk: RiskLevel): PolicyDecision {
    const rule = this.db.prepare(`
      select id, effect, risk_ceiling
      from policy_rules
      where org_id = ? and action = ?
      order by created_at asc
      limit 1
    `).get(orgId, "task_create") as PolicyRuleRow | undefined;
    if (!rule) throw new Error("Policy rule is required for task creation.");
    if (rule.effect !== "require_approval") throw new Error(`Unsupported policy effect: ${rule.effect}`);
    return {
      approvalRequired: RISK_RANK[risk] > RISK_RANK[rule.risk_ceiling],
      matchedRuleId: rule.id,
    };
  }
}

interface PolicyRuleRow {
  id: string;
  effect: string;
  risk_ceiling: RiskLevel;
}
