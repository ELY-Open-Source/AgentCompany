import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { MigrationService } from "../../src/main/services/migration-service";
import { OrganizationService } from "../../src/main/services/organization-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";

function createConnection(): DatabaseConnection {
  return new DatabaseConnection(join(tmpdir(), `agentcompany-new-migration-${randomUUID()}.db`));
}

function createOrganization(organization: OrganizationService): string {
  return organization.createOrganization({
    organizationName: "Acme Operations",
    employeeName: "Dana Lee",
    mission: "Coordinate agents with auditable approvals.",
    goal: "Ship a verified control plane.",
  });
}

function createLegacyDatabase(sql: string): string {
  const legacyPath = join(tmpdir(), `agentcompany-legacy-${randomUUID()}.db`);
  const legacy = new DatabaseSync(legacyPath);
  legacy.exec(sql);
  legacy.close();
  return legacyPath;
}

interface MigrationReportBody {
  sourceFingerprint: string;
  tableCounts: Record<string, number>;
  tableChecksums: Record<string, string>;
  idMaps: Record<string, string[]>;
  failures: Array<{ table: string; reason: string; detail: string }>;
  rollbackPack: {
    sourceDatabasePath: string;
    sourceFingerprint: string;
    tableChecksums: Record<string, string>;
    idMaps: Record<string, string[]>;
  };
}

describe("migration service", () => {
  test("creates idempotent reports with checksums, id maps, rollback pack, and integrity failures", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const migrations = new MigrationService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    const legacyPath = createLegacyDatabase(`
      create table organizations(id text primary key);
      insert into organizations(id) values ('org-1');
      create table employees(id text primary key, org_id text);
      insert into employees(id, org_id) values ('emp-1', 'org-1');
      create table agents(id text primary key, org_id text);
      insert into agents(id, org_id) values ('agent-1', 'org-missing');
      create table tasks(id text primary key, org_id text, assignee_agent_id text);
      insert into tasks(id, org_id, assignee_agent_id) values ('task-1', 'org-1', 'agent-missing');
    `);
    let orgId = "";
    let firstReportId = "";
    let secondReportId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      firstReportId = migrations.createReport({ orgId, sourceDatabasePath: legacyPath });
      secondReportId = migrations.createReport({ orgId, sourceDatabasePath: legacyPath });
    });

    const state = snapshot.load();
    const body = JSON.parse(state.migrationReports[0]!.reportJson) as MigrationReportBody;
    expect(secondReportId).toBe(firstReportId);
    expect(state.migrationReports).toHaveLength(1);
    expect(body.sourceFingerprint).toHaveLength(64);
    expect(body.tableCounts.organizations).toBe(1);
    expect(body.tableChecksums.agents).toHaveLength(64);
    expect(body.idMaps.tasks).toEqual(["task-1"]);
    expect(body.rollbackPack.sourceFingerprint).toBe(body.sourceFingerprint);
    expect(body.rollbackPack.tableChecksums.agents).toBe(body.tableChecksums.agents);
    expect(body.rollbackPack.idMaps.tasks).toEqual(["task-1"]);
    expect(body.failures).toContainEqual({ table: "agents", reason: "dangling_org_id", detail: "agent-1 -> org-missing" });
    expect(body.failures).toContainEqual({ table: "tasks", reason: "dangling_assignee_agent_id", detail: "task-1 -> agent-missing" });
    connection.close();
  });

  test("captures rebuilt domain tables and direct relation health", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const migrations = new MigrationService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    const legacyPath = createLegacyDatabase(`
      create table organizations(id text primary key);
      create table org_departments(id text primary key, org_id text, lead_agent_id text);
      create table hiring_policies(id text primary key, org_id text);
      create table employees(id text primary key, org_id text);
      create table employee_identities(id text primary key, org_id text, employee_id text);
      create table service_identities(id text primary key, org_id text, agent_id text);
      create table role_grants(id text primary key, org_id text, granted_by_employee_id text);
      create table access_decisions(id text primary key, org_id text);
      create table agents(id text primary key, org_id text, model_provider_id text, manager_agent_id text, workspace_id text);
      create table tasks(id text primary key, org_id text, assignee_agent_id text, project_id text, goal_id text, workspace_id text);
      create table workspaces(id text primary key, org_id text, project_id text);
      create table goals(id text primary key, org_id text, owner_agent_id text);
      create table projects(id text primary key, org_id text, goal_id text, lead_agent_id text);
      create table task_runs(id text primary key, org_id text, task_id text, agent_id text, provider_id text, provider_request_id text);
      create table approvals(id text primary key, org_id text, decided_by_employee_id text);
      create table approval_routing_rules(id text primary key, org_id text);
      create table approval_assignments(id text primary key, org_id text, approval_id text, routing_rule_id text);
      create table feature_flags(id text primary key, org_id text);
      create table slo_targets(id text primary key, org_id text);
      create table operational_events(id text primary key, org_id text);
      create table chaos_drills(id text primary key, org_id text);
      create table chaos_drill_runs(id text primary key, org_id text, drill_id text);
      create table sdlc_review_agents(id text primary key, org_id text);
      create table sdlc_review_runs(id text primary key, org_id text, review_agent_id text);
      create table eval_suites(id text primary key, org_id text);
      create table eval_cases(id text primary key, org_id text, suite_id text);
      create table eval_runs(id text primary key, org_id text, suite_id text);
      create table pr_bot_gates(id text primary key, org_id text);
      create table chat_spaces(id text primary key, org_id text);
      create table chat_messages(id text primary key, org_id text, space_id text, thread_id text);
      create table chat_threads(id text primary key, org_id text, space_id text, root_message_id text);
      create table chat_memberships(space_id text, principal_type text, principal_id text);
      create table chat_attachments(message_id text, file_id text);
      create table chat_mentions(message_id text, target_type text, target_id text);
      create table chat_slash_invocations(id text primary key, message_id text);
      create table board_interventions(id text primary key, org_id text, thread_id text, message_id text, approval_id text);
      create table chat_presence(principal_type text, principal_id text);
      create table chat_read_state(org_id text, employee_id text, space_id text, last_read_message_id text);
      create table providers(id text primary key, org_id text, credential_id text);
      create table provider_requests(id text primary key, org_id text, provider_id text);
      create table provider_usage_windows(id text primary key, org_id text, provider_id text);
      create table provider_rate_limit_observations(id text primary key, org_id text, provider_id text);
      create table credentials(id text primary key, org_id text);
      create table skill_definitions(id text primary key, org_id text);
      create table skill_revisions(id text primary key, skill_id text);
      create table skill_artifacts(id text primary key, revision_id text);
      create table skill_tests(id text primary key, revision_id text);
      create table skill_dependencies(revision_id text, depends_on_revision_id text);
      create table skill_bindings(id text primary key, org_id text, agent_id text, skill_id text, pinned_revision_id text);
      create table skill_runtime_snapshots(id text primary key, agent_id text, run_id text);
      create table skill_catalog_tags(skill_id text, tag text, tag_type text);
      create table file_objects(id text primary key, org_id text, space_id text);
      create table file_access_grants(id text primary key, org_id text, file_id text, source_message_id text, source_thread_id text);
      create table social_accounts(id text primary key, org_id text, authorized_employee_id text);
      create table social_account_grants(id text primary key, org_id text, social_account_id text, employee_id text);
      create table browser_session_containers(id text primary key, org_id text, social_account_id text);
      create table browser_action_policies(id text primary key, org_id text, social_account_id text);
      create table social_approval_routes(id text primary key, org_id text, social_account_id text, route_to_id text);
      create table browser_actions(id text primary key, org_id text, social_account_id text, evidence_file_id text);
      create table social_audit_records(id text primary key, org_id text, social_account_id text, evidence_file_id text);
      create table scheduled_posts(id text primary key, org_id text, social_account_id text, approval_id text, created_by_employee_id text);
      create table policy_rules(id text primary key, org_id text);
      create table compliance_exports(id text primary key, org_id text, requested_by_employee_id text);
      create table legal_holds(id text primary key, org_id text, created_by_employee_id text);
      create table retention_freezes(id text primary key, org_id text, created_by_employee_id text);
      create table search_documents(entity_id text);
      create table audit_replay_runs(id text primary key, org_id text, thread_id text, created_by_employee_id text);
      create table rollback_snapshots(id text primary key, org_id text, migration_report_id text, created_by_employee_id text);
      create table audit_events(id text primary key, org_id text);
      insert into organizations(id) values ('org-1');
      insert into employees(id, org_id) values ('emp-1', 'org-1');
      insert into employee_identities(id, org_id, employee_id) values ('eid-1', 'org-1', 'emp-1');
      insert into credentials(id, org_id) values ('cred-1', 'org-1');
      insert into providers(id, org_id, credential_id) values ('prov-1', 'org-1', 'cred-1');
      insert into chat_spaces(id, org_id) values ('space-1', 'org-1');
      insert into file_objects(id, org_id, space_id) values ('file-1', 'org-1', 'space-1');
      insert into workspaces(id, org_id, project_id) values ('wsp-1', 'org-1', 'prj-1');
      insert into agents(id, org_id, model_provider_id, manager_agent_id, workspace_id) values ('agent-1', 'org-1', 'prov-1', null, 'wsp-1');
      insert into org_departments(id, org_id, lead_agent_id) values ('dep-1', 'org-1', 'agent-1');
      insert into hiring_policies(id, org_id) values ('hpl-1', 'org-1');
      insert into service_identities(id, org_id, agent_id) values ('sid-1', 'org-1', 'agent-1');
      insert into role_grants(id, org_id, granted_by_employee_id) values ('role-1', 'org-1', 'emp-1');
      insert into access_decisions(id, org_id) values ('access-1', 'org-1');
      insert into goals(id, org_id, owner_agent_id) values ('goal-1', 'org-1', 'agent-1');
      insert into projects(id, org_id, goal_id, lead_agent_id) values ('prj-1', 'org-1', 'goal-1', 'agent-1');
      insert into tasks(id, org_id, assignee_agent_id, project_id, goal_id, workspace_id) values ('task-1', 'org-1', 'agent-1', 'prj-1', 'goal-1', 'wsp-1');
      insert into task_runs(id, org_id, task_id, agent_id, provider_id, provider_request_id) values ('run-1', 'org-1', 'task-1', 'agent-1', 'prov-1', 'req-1');
      insert into approvals(id, org_id, decided_by_employee_id) values ('approval-1', 'org-1', 'emp-1');
      insert into approval_routing_rules(id, org_id) values ('route-1', 'org-1');
      insert into approval_assignments(id, org_id, approval_id, routing_rule_id) values ('assign-1', 'org-1', 'approval-1', 'route-1');
      insert into feature_flags(id, org_id) values ('flag-1', 'org-1');
      insert into slo_targets(id, org_id) values ('slo-1', 'org-1');
      insert into operational_events(id, org_id) values ('op-1', 'org-1');
      insert into chaos_drills(id, org_id) values ('drill-1', 'org-1');
      insert into chaos_drill_runs(id, org_id, drill_id) values ('drill-run-1', 'org-1', 'drill-1');
      insert into sdlc_review_agents(id, org_id) values ('reviewer-1', 'org-1');
      insert into sdlc_review_runs(id, org_id, review_agent_id) values ('review-run-1', 'org-1', 'reviewer-1');
      insert into eval_suites(id, org_id) values ('suite-1', 'org-1');
      insert into eval_cases(id, org_id, suite_id) values ('case-1', 'org-1', 'suite-1');
      insert into eval_runs(id, org_id, suite_id) values ('eval-run-1', 'org-1', 'suite-1');
      insert into pr_bot_gates(id, org_id) values ('gate-1', 'org-1');
      insert into chat_threads(id, org_id, space_id, root_message_id) values ('thread-1', 'org-1', 'space-1', null);
      insert into chat_messages(id, org_id, space_id, thread_id) values ('msg-1', 'org-1', 'space-1', 'thread-1');
      insert into chat_memberships(space_id, principal_type, principal_id) values ('space-1', 'employee', 'emp-1');
      insert into chat_attachments(message_id, file_id) values ('msg-1', 'file-1');
      insert into file_access_grants(id, org_id, file_id, source_message_id, source_thread_id) values ('file-grant-1', 'org-1', 'file-1', 'msg-1', 'thread-1');
      insert into chat_mentions(message_id, target_type, target_id) values ('msg-1', 'agent', 'agent-1');
      insert into chat_slash_invocations(id, message_id) values ('slash-1', 'msg-1');
      insert into board_interventions(id, org_id, thread_id, message_id, approval_id) values ('bdi-1', 'org-1', 'thread-1', 'msg-1', 'approval-1');
      insert into chat_presence(principal_type, principal_id) values ('agent', 'agent-1');
      insert into chat_read_state(org_id, employee_id, space_id, last_read_message_id) values ('org-1', 'emp-1', 'space-1', 'msg-1');
      insert into provider_requests(id, org_id, provider_id) values ('req-1', 'org-1', 'prov-1');
      insert into provider_usage_windows(id, org_id, provider_id) values ('usage-1', 'org-1', 'prov-1');
      insert into provider_rate_limit_observations(id, org_id, provider_id) values ('quota-1', 'org-1', 'prov-1');
      insert into skill_definitions(id, org_id) values ('skill-1', 'org-1');
      insert into skill_revisions(id, skill_id) values ('rev-1', 'skill-1'), ('rev-2', 'skill-1');
      insert into skill_artifacts(id, revision_id) values ('artifact-1', 'rev-1');
      insert into skill_tests(id, revision_id) values ('test-1', 'rev-1');
      insert into skill_dependencies(revision_id, depends_on_revision_id) values ('rev-1', 'rev-2');
      insert into skill_bindings(id, org_id, agent_id, skill_id, pinned_revision_id) values ('binding-1', 'org-1', 'agent-1', 'skill-1', 'rev-1');
      insert into skill_runtime_snapshots(id, agent_id, run_id) values ('snapshot-1', 'agent-1', 'run-1');
      insert into skill_catalog_tags(skill_id, tag, tag_type) values ('skill-1', 'engineering', 'department');
      insert into social_accounts(id, org_id, authorized_employee_id) values ('social-1', 'org-1', 'emp-1');
      insert into social_account_grants(id, org_id, social_account_id, employee_id) values ('grant-1', 'org-1', 'social-1', 'emp-1');
      insert into browser_session_containers(id, org_id, social_account_id) values ('container-1', 'org-1', 'social-1');
      insert into browser_action_policies(id, org_id, social_account_id) values ('browser-policy-1', 'org-1', 'social-1');
      insert into social_approval_routes(id, org_id, social_account_id, route_to_id) values ('social-route-1', 'org-1', 'social-1', 'emp-1');
      insert into browser_actions(id, org_id, social_account_id, evidence_file_id) values ('browser-1', 'org-1', 'social-1', 'file-1');
      insert into social_audit_records(id, org_id, social_account_id, evidence_file_id) values ('social-audit-1', 'org-1', 'social-1', 'file-1');
      insert into scheduled_posts(id, org_id, social_account_id, approval_id, created_by_employee_id) values ('post-1', 'org-1', 'social-1', 'approval-1', 'emp-1');
      insert into policy_rules(id, org_id) values ('policy-1', 'org-1');
      insert into compliance_exports(id, org_id, requested_by_employee_id) values ('cmp-1', 'org-1', 'emp-1');
      insert into legal_holds(id, org_id, created_by_employee_id) values ('hold-1', 'org-1', 'emp-1');
      insert into retention_freezes(id, org_id, created_by_employee_id) values ('freeze-1', 'org-1', 'emp-1');
      insert into search_documents(entity_id) values ('task-1');
      insert into audit_replay_runs(id, org_id, thread_id, created_by_employee_id) values ('replay-1', 'org-1', 'thread-1', 'emp-1');
      insert into rollback_snapshots(id, org_id, migration_report_id, created_by_employee_id) values ('rollback-1', 'org-1', 'migration-1', 'emp-1');
      insert into audit_events(id, org_id) values ('audit-1', 'org-1');
    `);
    let orgId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      migrations.createReport({ orgId, sourceDatabasePath: legacyPath });
    });

    const body = JSON.parse(snapshot.load().migrationReports[0]!.reportJson) as MigrationReportBody;
    expect(body.failures).toEqual([]);
    expect(body.tableCounts.credentials).toBe(1);
    expect(body.tableCounts.employee_identities).toBe(1);
    expect(body.tableCounts.org_departments).toBe(1);
    expect(body.tableCounts.hiring_policies).toBe(1);
    expect(body.tableCounts.feature_flags).toBe(1);
    expect(body.tableCounts.chaos_drill_runs).toBe(1);
    expect(body.tableCounts.sdlc_review_runs).toBe(1);
    expect(body.tableCounts.eval_cases).toBe(1);
    expect(body.tableCounts.role_grants).toBe(1);
    expect(body.tableCounts.skill_artifacts).toBe(1);
    expect(body.tableCounts.chat_read_state).toBe(1);
    expect(body.tableCounts.board_interventions).toBe(1);
    expect(body.tableCounts.file_access_grants).toBe(1);
    expect(body.tableCounts.provider_requests).toBe(1);
    expect(body.tableCounts.provider_usage_windows).toBe(1);
    expect(body.tableCounts.provider_rate_limit_observations).toBe(1);
    expect(body.tableCounts.browser_session_containers).toBe(1);
    expect(body.tableCounts.browser_action_policies).toBe(1);
    expect(body.tableCounts.social_approval_routes).toBe(1);
    expect(body.tableCounts.social_audit_records).toBe(1);
    expect(body.tableCounts.compliance_exports).toBe(1);
    expect(body.tableCounts.audit_replay_runs).toBe(1);
    expect(body.tableCounts.rollback_snapshots).toBe(1);
    expect(body.tableCounts.search_documents).toBe(1);
    expect(body.tableChecksums.audit_events).toHaveLength(64);
    expect(body.idMaps.skill_runtime_snapshots).toEqual(["snapshot-1"]);
    expect(body.idMaps.service_identities).toEqual(["sid-1"]);
    expect(body.idMaps.access_decisions).toEqual(["access-1"]);
    expect(body.idMaps.approval_assignments).toEqual(["assign-1"]);
    expect(body.idMaps.operational_events).toEqual(["op-1"]);
    expect(body.idMaps.chaos_drill_runs).toEqual(["drill-run-1"]);
    expect(body.idMaps.sdlc_review_runs).toEqual(["review-run-1"]);
    expect(body.idMaps.eval_runs).toEqual(["eval-run-1"]);
    expect(body.idMaps.board_interventions).toEqual(["bdi-1"]);
    expect(body.idMaps.retention_freezes).toEqual(["freeze-1"]);
    expect(body.idMaps.audit_replay_runs).toEqual(["replay-1"]);
    expect(body.idMaps.rollback_snapshots).toEqual(["rollback-1"]);
    expect(body.idMaps.provider_usage_windows).toEqual(["usage-1"]);
    expect(body.idMaps.provider_rate_limit_observations).toEqual(["quota-1"]);
    expect(body.idMaps.browser_session_containers).toEqual(["container-1"]);
    expect(body.idMaps.browser_action_policies).toEqual(["browser-policy-1"]);
    expect(body.idMaps.social_approval_routes).toEqual(["social-route-1"]);
    expect(body.idMaps.social_audit_records).toEqual(["social-audit-1"]);
    connection.close();
  });

  test("rejects reports for unknown target organizations", () => {
    const connection = createConnection();
    const migrations = new MigrationService(connection.db);
    const legacyPath = createLegacyDatabase("create table organizations(id text primary key);");

    expect(() => connection.transaction(() => migrations.createReport({
      orgId: "org_missing",
      sourceDatabasePath: legacyPath,
    }))).toThrow("Organization was not found.");
    connection.close();
  });
});
