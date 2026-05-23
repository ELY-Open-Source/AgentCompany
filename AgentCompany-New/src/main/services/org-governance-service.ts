import type { DatabaseSync } from "node:sqlite";
import type { CreateAgentInput } from "../../shared/commands";
import { RISK_LEVEL, ROUTE_TO_TYPE, type RiskLevel } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";

const DEFAULT_DEPARTMENTS = ["Executive", "Engineering", "Product", "Design", "Marketing", "Operations", "Support"] as const;
const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export class OrgGovernanceService {
  private readonly audit: AuditService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
  }

  seedOrganizationGovernance(orgId: string, boardEmployeeId: string, now: string): void {
    for (const department of DEFAULT_DEPARTMENTS) this.seedDepartmentPolicy(orgId, department, now);
    this.db.prepare(`
      insert into approval_routing_rules(id, org_id, kind, minimum_risk, route_to_type, route_to_id, created_at)
      values (?, ?, ?, ?, ?, ?, ?)
      on conflict(org_id, kind, minimum_risk) do nothing
    `).run(createId("arr"), orgId, "*", RISK_LEVEL.LOW, ROUTE_TO_TYPE.EMPLOYEE, boardEmployeeId, now);
  }

  enforceHiringPolicy(input: CreateAgentInput): HiringPolicyDecision {
    const departmentName = input.department.trim();
    if (!departmentName) throw new Error("Department is required.");
    const policy = this.db.prepare(`
      select max_headcount, monthly_budget_limit_cents, require_approval_above_cents
      from hiring_policies
      where org_id = ? and department_name = ?
    `).get(input.orgId, departmentName) as HiringPolicyRow | undefined;
    if (!policy) throw new Error("Hiring policy is required for department.");
    const usage = this.db.prepare(`
      select count(*) as headcount, coalesce(sum(budget_cents), 0) as budget_cents
      from agents
      where org_id = ? and department = ? and lifecycle = ?
    `).get(input.orgId, departmentName, "active") as { headcount: number; budget_cents: number };
    if (usage.headcount >= policy.max_headcount) throw new Error("Department headcount limit has been reached.");
    if (usage.budget_cents + input.budgetCents > policy.monthly_budget_limit_cents) {
      throw new Error("Department monthly budget limit has been reached.");
    }
    return { reviewRequired: input.budgetCents > policy.require_approval_above_cents };
  }

  routeApproval(input: { orgId: string; approvalId: string; kind: string; risk: RiskLevel }): void {
    const rule = this.resolveRoutingRule(input.orgId, input.kind, input.risk);
    this.assertRouteTarget(input.orgId, rule.route_to_type, rule.route_to_id);
    this.db.prepare(`
      insert into approval_assignments(id, org_id, approval_id, assignee_type, assignee_id, routing_rule_id, created_at)
      values (?, ?, ?, ?, ?, ?, ?)
      on conflict(approval_id, assignee_type, assignee_id) do nothing
    `).run(createId("aas"), input.orgId, input.approvalId, rule.route_to_type, rule.route_to_id, rule.id, new Date().toISOString());
    this.audit.record({
      orgId: input.orgId,
      entityType: "approval",
      entityId: input.approvalId,
      actorType: "system",
      actorId: null,
      action: "routed",
      payload: { routingRuleId: rule.id, routeToType: rule.route_to_type, routeToId: rule.route_to_id },
    });
  }

  private seedDepartmentPolicy(orgId: string, departmentName: string, now: string): void {
    this.db.prepare(`
      insert into org_departments(id, org_id, name, lead_agent_id, headcount_limit, monthly_budget_limit_cents, created_at, updated_at)
      values (?, ?, ?, null, 12, 2500000, ?, ?)
      on conflict(org_id, name) do nothing
    `).run(createId("dep"), orgId, departmentName, now, now);
    this.db.prepare(`
      insert into hiring_policies(id, org_id, department_name, max_headcount, monthly_budget_limit_cents, require_approval_above_cents, created_at, updated_at)
      values (?, ?, ?, 12, 2500000, 500000, ?, ?)
      on conflict(org_id, department_name) do nothing
    `).run(createId("hpl"), orgId, departmentName, now, now);
  }

  private resolveRoutingRule(orgId: string, kind: string, risk: RiskLevel): ApprovalRoutingRuleRow {
    const rows = this.db.prepare(`
      select id, kind, minimum_risk, route_to_type, route_to_id
      from approval_routing_rules
      where org_id = ? and (kind = ? or kind = ?)
    `).all(orgId, kind, "*") as unknown as ApprovalRoutingRuleRow[];
    const matching = rows
      .filter((row) => riskApplies(row.minimum_risk, risk))
      .sort((a, b) => ruleRank(kind, b) - ruleRank(kind, a));
    const selected = matching[0];
    if (!selected) throw new Error("Approval routing rule is required.");
    return selected;
  }

  private assertRouteTarget(orgId: string, routeToType: string, routeToId: string): void {
    if (routeToType === ROUTE_TO_TYPE.BOARD) {
      if (routeToId !== orgId) throw new Error("Board approval route is invalid.");
      return;
    }
    if (routeToType === ROUTE_TO_TYPE.EMPLOYEE) {
      const employee = this.db.prepare("select id from employees where id = ? and org_id = ?").get(routeToId, orgId);
      if (!employee) throw new Error("Approval route employee was not found.");
      return;
    }
    if (routeToType === ROUTE_TO_TYPE.AGENT) {
      const agent = this.db.prepare("select id from agents where id = ? and org_id = ?").get(routeToId, orgId);
      if (!agent) throw new Error("Approval route agent was not found.");
      return;
    }
    throw new Error("Approval route target type is invalid.");
  }
}

interface HiringPolicyRow {
  max_headcount: number;
  monthly_budget_limit_cents: number;
  require_approval_above_cents: number;
}

interface HiringPolicyDecision {
  reviewRequired: boolean;
}

interface ApprovalRoutingRuleRow {
  id: string;
  kind: string;
  minimum_risk: string;
  route_to_type: string;
  route_to_id: string;
}

function riskApplies(minimumRisk: string, risk: RiskLevel): boolean {
  const required = RISK_RANK[minimumRisk as RiskLevel];
  if (required === undefined) throw new Error("Approval routing risk is invalid.");
  return RISK_RANK[risk] >= required;
}

function ruleRank(kind: string, rule: ApprovalRoutingRuleRow): number {
  const exactKind = rule.kind === kind ? 100 : 0;
  return exactKind + RISK_RANK[rule.minimum_risk as RiskLevel];
}
