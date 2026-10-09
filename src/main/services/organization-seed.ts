import { COMPANY_PRESETS } from "../../shared/company-presets";
import type { DatabaseSync } from "node:sqlite";
import type { CreateOrganizationInput } from "../../shared/commands";
import { PROVIDER_CATALOG } from "../../shared/provider-catalog";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";
import { PolicyService } from "./policy-service";
import { IdentityAccessService } from "./identity-access-service";
import { OrgGovernanceService } from "./org-governance-service";
import { OperationsService } from "./operations-service";
import { assertUsableMentionName } from "../../shared/mention-handles";

/**
 * Seeds a brand-new organization in one transaction's worth of writes: the org
 * row and its Board Chair employee, the identity / governance / operations /
 * SDLC / policy defaults, the starter chat channels, the disabled provider
 * catalog, and the active-org pointer. Returns the new organization id.
 */
export function seedOrganization(db: DatabaseSync, input: CreateOrganizationInput): string {
  const audit = new AuditService(db);
  const policy = new PolicyService(db);
  const identityAccess = new IdentityAccessService(db);
  const governance = new OrgGovernanceService(db);
  const operations = new OperationsService(db);

  assertUsableMentionName(input.employeeName);
  const orgId = createId("org");
  const employeeId = createId("emp");
  const now = new Date().toISOString();

  db.prepare(`
    insert into organizations(
      id, name, mission, goal, description, execution_mode, auto_approve_hires, review_deliverables, created_at
    )
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    orgId,
    input.organizationName.trim(),
    input.mission.trim(),
    input.goal.trim(),
    input.description?.trim() ?? "",
    input.executionMode ?? "ai_ceo",
    input.autoApproveHires === false ? 0 : 1,
    input.reviewDeliverables === true ? 1 : 0,
    now,
  );
  db.prepare("insert into employees(id, org_id, display_name, role, created_at) values (?, ?, ?, ?, ?)")
    .run(employeeId, orgId, input.employeeName.trim(), "Board Chair", now);
  identityAccess.seedEmployeeAccess(orgId, employeeId, now);
  governance.seedOrganizationGovernance(orgId, employeeId, now);
  operations.seedOrganizationOperations(orgId, now);

  for (const space of [
    ["company", "general", "Company coordination", "workspace"],
    ["department", "product", "Product decisions", "workspace"],
    ["department", "engineering", "Engineering delivery", "workspace"],
    ["company", "board", "Board decisions", "restricted"],
  ]) {
    const spaceId = createId("spc");
    db.prepare(`
      insert into chat_spaces(id, org_id, space_type, name, topic, visibility, created_at)
      values (?, ?, ?, ?, ?, ?, ?)
    `).run(spaceId, orgId, space[0], space[1], space[2], space[3], now);
    db.prepare(`
      insert into chat_memberships(space_id, principal_type, principal_id, role, mute_state)
      values (?, ?, ?, ?, ?)
    `).run(spaceId, "employee", employeeId, space[1] === "board" ? "approver" : "member", "unmuted");
  }

  for (const provider of PROVIDER_CATALOG) {
    db.prepare(`
      insert into providers(id, org_id, provider_key, label, auth_type, model, credential_id, enabled, monthly_request_limit, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      createId("prv"),
      orgId,
      provider.key,
      provider.label,
      provider.authType,
      provider.defaultModel,
      null,
      0,
      COMPANY_PRESETS.providerMonthlyRequests,
      now,
    );
  }

  policy.seedOrganizationPolicies(orgId, now);
  db.prepare(`
    insert into app_state(id, active_org_id, updated_at)
    values (1, ?, ?)
    on conflict(id) do update set active_org_id = excluded.active_org_id, updated_at = excluded.updated_at
  `).run(orgId, now);
  audit.record({
    orgId,
    entityType: "organization",
    entityId: orgId,
    actorType: "employee",
    actorId: employeeId,
    action: "created",
    payload: { name: input.organizationName.trim() },
  });
  return orgId;
}
