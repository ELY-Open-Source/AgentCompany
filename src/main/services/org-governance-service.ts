import type { DatabaseSync } from "node:sqlite";
import type { CreateAgentInput } from "../../shared/commands";
import { RISK_LEVEL, ROUTE_TO_TYPE, SLO_SIGNAL_KEY, type RiskLevel } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";
import { OperationsService } from "./operations-service";

export const ORGANIZATION_DEPARTMENTS = ["Executive", "Engineering", "Product", "Design", "Marketing", "Sales", "Finance", "Operations", "Support"] as const;
const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export class OrgGovernanceService {
  private readonly audit: AuditService;
  private readonly operations: OperationsService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
    this.operations = new OperationsService(db);
  }

  seedOrganizationGovernance(orgId: string, boardEmployeeId: string, now: string): void {
    for (const department of ORGANIZATION_DEPARTMENTS) this.seedDepartmentPolicy(orgId, department, now);
    this.db.prepare(`
      insert into approval_routing_rules(id, org_id, kind, minimum_risk, route_to_type, route_to_id, created_at)
      values (?, ?, ?, ?, ?, ?, ?)
      on conflict(org_id, kind, minimum_risk) do nothing
    `).run(createId("arr"), orgId, "*", RISK_LEVEL.LOW, ROUTE_TO_TYPE.EMPLOYEE, boardEmployeeId, now);
  }

  /** Resolves the canonical department name (case-insensitive), or throws naming the valid choices. */
  requireCanonicalDepartment(orgId: string, department: string): string {
    const requested = department.trim();
    if (!requested) throw new Error("Department is required.");
    const row = this.db.prepare(`
      select department_name from hiring_policies
      where org_id = ? and lower(department_name) = lower(?)
    `).get(orgId, requested) as { department_name: string } | undefined;
    if (!row) {
      const known = this.db.prepare("select department_name from hiring_policies where org_id = ? order by department_name asc")
        .all(orgId) as Array<{ department_name: string }>;
      throw new Error(`Unknown department "${requested}". Departments: ${known.map((entry) => entry.department_name).join(", ")}.`);
    }
    return row.department_name;
  }

  enforceHiringPolicy(input: CreateAgentInput): HiringPolicyDecision {
    const departmentName = this.requireCanonicalDepartment(input.orgId, input.department);
    const policy = this.db.prepare(`
      select max_headcount, monthly_budget_limit_cents, require_approval_above_cents
      from hiring_policies
      where org_id = ? and department_name = ?
    `).get(input.orgId, departmentName) as HiringPolicyRow | undefined;
    if (!policy) throw new Error("Hiring policy is required for department.");
    const usage = this.db.prepare(`
      select count(*) as headcount, coalesce(sum(budget_cents), 0) as budget_cents
      from agents
      where org_id = ? and department = ? and lifecycle in ('active', 'pending_hire')
    `).get(input.orgId, departmentName) as { headcount: number; budget_cents: number };
    if (usage.headcount >= policy.max_headcount) throw new Error("Department headcount limit has been reached.");
    if (usage.budget_cents + input.budgetCents > policy.monthly_budget_limit_cents) {
      throw new Error("Department monthly budget limit has been reached.");
    }
    return { reviewRequired: input.budgetCents > policy.require_approval_above_cents, departmentName };
  }

  /** c_suite is the CEO's rank and carries company-wide powers: one per company, and no edit grants or removes it. */
  assertRank(orgId: string, agentId: string | null, nextLevel: string): void {
    const current = agentId
      ? (this.db.prepare("select role_level from agents where id = ? and org_id = ?").get(agentId, orgId) as { role_level: string } | undefined)?.role_level ?? null
      : null;
    if (current === "c_suite" && nextLevel !== "c_suite") {
      throw new Error("The CEO's rank carries company-wide powers (hiring officers, granting connectors and skills, closing goals) and cannot be changed by an edit.");
    }
    if (nextLevel !== "c_suite" || current === "c_suite") return;
    if (agentId) throw new Error("The CEO's rank carries company-wide powers and cannot be given by an edit; officers are directors with a title.");
    const ceo = this.db.prepare("select 1 from agents where org_id = ? and role_level = 'c_suite' and lifecycle in ('active', 'pending_hire')").get(orgId);
    if (ceo) throw new Error("The company already has its CEO; officers are directors with a title.");
  }

  /** An existing agent moving department or changing budget meets the same limits a hire does. */
  enforceStaffingChange(input: { orgId: string; agentId: string; departmentName: string; budgetCents: number }): void {
    const policy = this.db.prepare("select max_headcount, monthly_budget_limit_cents from hiring_policies where org_id = ? and department_name = ?")
      .get(input.orgId, input.departmentName) as { max_headcount: number; monthly_budget_limit_cents: number } | undefined;
    if (!policy) throw new Error("Hiring policy is required for department.");
    const others = this.db.prepare(`
      select count(*) as headcount, coalesce(sum(budget_cents), 0) as budget_cents
      from agents where org_id = ? and department = ? and lifecycle in ('active', 'pending_hire') and id <> ?
    `).get(input.orgId, input.departmentName, input.agentId) as { headcount: number; budget_cents: number };
    const current = this.db.prepare("select department, budget_cents from agents where id = ? and org_id = ?").get(input.agentId, input.orgId) as { department: string; budget_cents: number };
    const moving = current.department !== input.departmentName;
    // Edits that neither move the agent nor raise its budget never trip a limit, even in a department already over it.
    if (!moving && input.budgetCents <= current.budget_cents) return;
    if (moving && others.headcount >= policy.max_headcount) {
      throw new Error(`${input.departmentName} is at its headcount limit (${policy.max_headcount}).`);
    }
    const total = others.budget_cents + input.budgetCents;
    if (total > policy.monthly_budget_limit_cents) {
      throw new Error(`${input.departmentName} would budget $${(total / 100).toFixed(2)} a month, over its $${(policy.monthly_budget_limit_cents / 100).toFixed(2)} limit.`);
    }
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
    this.operations.recordSignal({
      orgId: input.orgId,
      signalKey: SLO_SIGNAL_KEY.APPROVAL_ROUTE_COVERAGE,
      source: "approval_routing",
      success: true,
      durationMs: null,
      detail: { approvalId: input.approvalId, routingRuleId: rule.id },
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
  /** Canonical department name from the policy table (the input may differ in case). */
  departmentName: string;
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
