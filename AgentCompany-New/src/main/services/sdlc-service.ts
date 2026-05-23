import type { DatabaseSync } from "node:sqlite";
import type { RunEvalSuiteInput, RunSdlcReviewInput, SetPrBotGateInput } from "../../shared/commands";
import {
  EVAL_SUITE_KEY,
  PR_BOT_GATE_KEY,
  SDLC_REVIEW_AGENT_KEY,
  SDLC_REVIEW_TARGET_TYPE,
  SDLC_RUN_STATE,
  type EvalSuiteKey,
  type SdlcReviewAgentKey,
  type SdlcReviewTargetType,
} from "../../shared/domain";
import { PROVIDER_CATALOG } from "../../shared/provider-catalog";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";
import { providerAdapters } from "./provider-adapters";

const REVIEW_AGENTS = [
  { key: SDLC_REVIEW_AGENT_KEY.CODE_REVIEWER, label: "Code Review Agent", specialty: "static quality and architecture" },
  { key: SDLC_REVIEW_AGENT_KEY.MIGRATION_REVIEWER, label: "Migration Review Agent", specialty: "schema diff and rollback evidence" },
  { key: SDLC_REVIEW_AGENT_KEY.POLICY_REVIEWER, label: "Policy Review Agent", specialty: "provider, approval, and access policy" },
] as const;

const EVAL_SUITES = [
  { key: EVAL_SUITE_KEY.CONTRACT, label: "Contract checks", scope: "provider adapters, event schemas, slash commands" },
  { key: EVAL_SUITE_KEY.INTEGRATION, label: "Integration checks", scope: "chat, approval, file, skill resolution flows" },
  { key: EVAL_SUITE_KEY.REPLAY, label: "Replay checks", scope: "audit timeline and historical decision regression" },
] as const;

const EVAL_CASES = [
  { suiteKey: EVAL_SUITE_KEY.CONTRACT, title: "Provider catalog has adapters", sourceType: "provider_gateway", sourceRef: "providers", expectedSignal: "adapter_coverage" },
  { suiteKey: EVAL_SUITE_KEY.CONTRACT, title: "Schema ledger is current", sourceType: "database", sourceRef: "schema_migrations", expectedSignal: "migration_ledger" },
  { suiteKey: EVAL_SUITE_KEY.INTEGRATION, title: "Approval routes are assigned", sourceType: "org_governance", sourceRef: "approval_assignments", expectedSignal: "route_coverage" },
  { suiteKey: EVAL_SUITE_KEY.INTEGRATION, title: "Skills can resolve runtime snapshots", sourceType: "skills_platform", sourceRef: "skill_runtime_snapshots", expectedSignal: "skill_resolution" },
  { suiteKey: EVAL_SUITE_KEY.REPLAY, title: "Audit timeline has domain events", sourceType: "audit", sourceRef: "audit_events", expectedSignal: "replayable_timeline" },
  { suiteKey: EVAL_SUITE_KEY.REPLAY, title: "Operational signals are captured", sourceType: "operations", sourceRef: "operational_events", expectedSignal: "slo_signal" },
] as const;

const PR_BOT_GATES = [
  { key: PR_BOT_GATE_KEY.STATIC_CHECKS, label: "Static checks", gateType: "typecheck_lint_test" },
  { key: PR_BOT_GATE_KEY.MIGRATION_DIFF, label: "Migration diff", gateType: "schema_review" },
  { key: PR_BOT_GATE_KEY.POLICY_DIFF, label: "Policy diff", gateType: "policy_review" },
  { key: PR_BOT_GATE_KEY.HUMAN_APPROVAL, label: "Human approval", gateType: "approval_required" },
] as const;

interface ReviewAgentRow {
  id: string;
  key: SdlcReviewAgentKey;
  enabled: number;
}

interface EvalSuiteRow {
  id: string;
  key: EvalSuiteKey;
}

interface GateCheck {
  key: string;
  passed: boolean;
  value: number | string | boolean;
}

export class SdlcService {
  private readonly audit: AuditService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
  }

  seedOrganizationSdlc(orgId: string, now: string): void {
    for (const agent of REVIEW_AGENTS) {
      this.db.prepare(`
        insert into sdlc_review_agents(id, org_id, key, label, specialty, enabled, created_at, updated_at)
        values (?, ?, ?, ?, ?, 1, ?, ?)
        on conflict(org_id, key) do nothing
      `).run(createId("sra"), orgId, agent.key, agent.label, agent.specialty, now, now);
    }
    for (const suite of EVAL_SUITES) {
      this.db.prepare(`
        insert into eval_suites(id, org_id, key, label, scope, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?)
        on conflict(org_id, key) do nothing
      `).run(createId("evs"), orgId, suite.key, suite.label, suite.scope, now, now);
    }
    for (const item of EVAL_CASES) {
      const suite = this.requireSuiteByKey(orgId, item.suiteKey);
      this.db.prepare(`
        insert into eval_cases(id, org_id, suite_id, title, source_type, source_ref, expected_signal, created_at)
        values (?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(suite_id, title) do nothing
      `).run(createId("evc"), orgId, suite.id, item.title, item.sourceType, item.sourceRef, item.expectedSignal, now);
    }
    for (const gate of PR_BOT_GATES) {
      this.db.prepare(`
        insert into pr_bot_gates(id, org_id, key, label, gate_type, enabled, created_at, updated_at)
        values (?, ?, ?, ?, ?, 1, ?, ?)
        on conflict(org_id, key) do nothing
      `).run(createId("pbg"), orgId, gate.key, gate.label, gate.gateType, now, now);
    }
  }

  runReview(input: RunSdlcReviewInput): string {
    const agent = this.db.prepare("select id, key, enabled from sdlc_review_agents where id = ? and org_id = ?")
      .get(input.reviewAgentId, input.orgId) as ReviewAgentRow | undefined;
    if (!agent) throw new Error("SDLC review agent was not found.");
    if (agent.enabled !== 1) throw new Error("SDLC review agent is disabled.");
    this.assertTarget(input.orgId, input.targetType, input.targetRef);
    const checks = this.reviewChecks(input.orgId, agent.key, input.targetType);
    const state = checks.every((check) => check.passed) ? SDLC_RUN_STATE.PASSED : SDLC_RUN_STATE.FAILED;
    const id = createId("srr");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into sdlc_review_runs(id, org_id, review_agent_id, target_type, target_ref, state, result_json, created_at, completed_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.orgId, input.reviewAgentId, input.targetType, input.targetRef, state, JSON.stringify({ checks }), now, now);
    this.audit.record({
      orgId: input.orgId,
      entityType: "sdlc_review_run",
      entityId: id,
      actorType: "system",
      actorId: null,
      action: "created",
      payload: { reviewAgentKey: agent.key, state, targetType: input.targetType },
    });
    return id;
  }

  runEvalSuite(input: RunEvalSuiteInput): string {
    const suite = this.db.prepare("select id, key from eval_suites where id = ? and org_id = ?")
      .get(input.suiteId, input.orgId) as EvalSuiteRow | undefined;
    if (!suite) throw new Error("Eval suite was not found.");
    const checks = this.evalChecks(input.orgId, suite.key);
    const passedCount = checks.filter((check) => check.passed).length;
    const failedCount = checks.length - passedCount;
    const state = failedCount === 0 ? SDLC_RUN_STATE.PASSED : SDLC_RUN_STATE.FAILED;
    const id = createId("evr");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into eval_runs(id, org_id, suite_id, state, passed_count, failed_count, result_json, created_at, completed_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.orgId, input.suiteId, state, passedCount, failedCount, JSON.stringify({ checks }), now, now);
    this.audit.record({
      orgId: input.orgId,
      entityType: "eval_run",
      entityId: id,
      actorType: "system",
      actorId: null,
      action: "created",
      payload: { suiteKey: suite.key, state, passedCount, failedCount },
    });
    return id;
  }

  setPrBotGate(input: SetPrBotGateInput): void {
    const gate = this.db.prepare("select key from pr_bot_gates where id = ? and org_id = ?")
      .get(input.gateId, input.orgId) as { key: string } | undefined;
    if (!gate) throw new Error("PR bot gate was not found.");
    const now = new Date().toISOString();
    const result = this.db.prepare("update pr_bot_gates set enabled = ?, updated_at = ? where id = ? and org_id = ?")
      .run(input.enabled ? 1 : 0, now, input.gateId, input.orgId);
    if (result.changes === 0) throw new Error("PR bot gate was not found.");
    this.audit.record({
      orgId: input.orgId,
      entityType: "pr_bot_gate",
      entityId: input.gateId,
      actorType: "system",
      actorId: null,
      action: "updated",
      payload: { key: gate.key, enabled: input.enabled },
    });
  }

  private requireSuiteByKey(orgId: string, key: EvalSuiteKey): { id: string } {
    const suite = this.db.prepare("select id from eval_suites where org_id = ? and key = ?")
      .get(orgId, key) as { id: string } | undefined;
    if (!suite) throw new Error("Eval suite is required.");
    return suite;
  }

  private assertTarget(orgId: string, type: SdlcReviewTargetType, ref: string): void {
    if (!Object.values(SDLC_REVIEW_TARGET_TYPE).includes(type)) throw new Error("SDLC review target type is invalid.");
    const targetRef = ref.trim();
    if (!targetRef) throw new Error("SDLC review target is required.");
    if (type === SDLC_REVIEW_TARGET_TYPE.WORKSPACE) {
      const org = this.db.prepare("select id from organizations where id = ?").get(targetRef);
      if (!org || targetRef !== orgId) throw new Error("SDLC workspace target is invalid.");
      return;
    }
    if (type === SDLC_REVIEW_TARGET_TYPE.MIGRATION) {
      const report = this.db.prepare("select id from migration_reports where id = ? and org_id = ?").get(targetRef, orgId);
      if (!report) throw new Error("SDLC migration target was not found.");
      return;
    }
    const policy = this.db.prepare("select id from policy_rules where id = ? and org_id = ?").get(targetRef, orgId);
    if (!policy) throw new Error("SDLC policy target was not found.");
  }

  private reviewChecks(orgId: string, agentKey: SdlcReviewAgentKey, targetType: SdlcReviewTargetType): GateCheck[] {
    if (agentKey === SDLC_REVIEW_AGENT_KEY.MIGRATION_REVIEWER) return this.migrationReviewChecks(orgId);
    if (agentKey === SDLC_REVIEW_AGENT_KEY.POLICY_REVIEWER) return this.policyReviewChecks(orgId);
    return this.codeReviewChecks(orgId, targetType);
  }

  private codeReviewChecks(orgId: string, targetType: SdlcReviewTargetType): GateCheck[] {
    const enabledGates = count(this.db, "select count(*) as count from pr_bot_gates where org_id = ? and enabled = 1", orgId);
    const auditEvents = count(this.db, "select count(*) as count from audit_events where org_id = ?", orgId);
    return [
      { key: "target_type", passed: targetType === SDLC_REVIEW_TARGET_TYPE.WORKSPACE, value: targetType },
      { key: "enabled_pr_gates", passed: enabledGates >= 3, value: enabledGates },
      { key: "recent_audit_events", passed: auditEvents > 0, value: auditEvents },
    ];
  }

  private migrationReviewChecks(orgId: string): GateCheck[] {
    const reports = this.db.prepare("select report_json from migration_reports where org_id = ?").all(orgId) as Array<{ report_json: string }>;
    const rollbackPacks = reports.filter((report) => hasObjectField(report.report_json, "rollbackPack")).length;
    const migrationGateEnabled = this.isGateEnabled(orgId, PR_BOT_GATE_KEY.MIGRATION_DIFF);
    return [
      { key: "migration_gate_enabled", passed: migrationGateEnabled, value: migrationGateEnabled },
      { key: "rollback_pack_coverage", passed: reports.length === rollbackPacks, value: `${rollbackPacks}/${reports.length}` },
    ];
  }

  private policyReviewChecks(orgId: string): GateCheck[] {
    const providerConflicts = count(this.db, "select count(*) as count from providers where org_id = ? and data_policy = 'zero_data_retention' and background_enabled = 1", orgId);
    const routeRules = count(this.db, "select count(*) as count from approval_routing_rules where org_id = ?", orgId);
    const policyGateEnabled = this.isGateEnabled(orgId, PR_BOT_GATE_KEY.POLICY_DIFF);
    return [
      { key: "policy_gate_enabled", passed: policyGateEnabled, value: policyGateEnabled },
      { key: "provider_policy_conflicts", passed: providerConflicts === 0, value: providerConflicts },
      { key: "approval_routes", passed: routeRules > 0, value: routeRules },
    ];
  }

  private evalChecks(orgId: string, suiteKey: EvalSuiteKey): GateCheck[] {
    if (suiteKey === EVAL_SUITE_KEY.CONTRACT) return this.contractEvalChecks();
    if (suiteKey === EVAL_SUITE_KEY.INTEGRATION) return this.integrationEvalChecks(orgId);
    return this.replayEvalChecks(orgId);
  }

  private contractEvalChecks(): GateCheck[] {
    const catalogKeys = PROVIDER_CATALOG.map((provider) => provider.key);
    const adapterKeys = Object.keys(providerAdapters);
    const missing = catalogKeys.filter((key) => !adapterKeys.includes(key));
    const runtimeContractReady = PROVIDER_CATALOG.every((provider) => {
      const adapter = providerAdapters[provider.key];
      return typeof adapter.listModels === "function" && typeof adapter.getRateLimitState === "function";
    });
    const schemaVersion = count(this.db, "select coalesce(max(version), 0) as count from schema_migrations");
    return [
      { key: "provider_adapter_coverage", passed: missing.length === 0, value: `${adapterKeys.length}/${catalogKeys.length}` },
      { key: "provider_runtime_contract", passed: runtimeContractReady, value: runtimeContractReady },
      { key: "schema_version", passed: schemaVersion >= 21, value: schemaVersion },
    ];
  }

  private integrationEvalChecks(orgId: string): GateCheck[] {
    const chatSpaces = count(this.db, "select count(*) as count from chat_spaces where org_id = ?", orgId);
    const approvalRoutes = count(this.db, "select count(*) as count from approval_routing_rules where org_id = ?", orgId);
    const skillSnapshots = count(this.db, `
      select count(*) as count
      from skill_runtime_snapshots
      join agents on agents.id = skill_runtime_snapshots.agent_id
      where agents.org_id = ?
    `, orgId);
    return [
      { key: "chat_spaces", passed: chatSpaces > 0, value: chatSpaces },
      { key: "approval_routes", passed: approvalRoutes > 0, value: approvalRoutes },
      { key: "skill_runtime_snapshots", passed: skillSnapshots > 0, value: skillSnapshots },
    ];
  }

  private replayEvalChecks(orgId: string): GateCheck[] {
    const auditEvents = count(this.db, "select count(*) as count from audit_events where org_id = ?", orgId);
    const operationalEvents = count(this.db, "select count(*) as count from operational_events where org_id = ?", orgId);
    return [
      { key: "audit_events", passed: auditEvents > 0, value: auditEvents },
      { key: "operational_events", passed: operationalEvents > 0, value: operationalEvents },
    ];
  }

  private isGateEnabled(orgId: string, key: string): boolean {
    const row = this.db.prepare("select enabled from pr_bot_gates where org_id = ? and key = ?")
      .get(orgId, key) as { enabled: number } | undefined;
    if (!row) throw new Error("PR bot gate is required.");
    return row.enabled === 1;
  }
}

function count(db: DatabaseSync, sql: string, ...params: string[]): number {
  return (db.prepare(sql).get(...params) as { count: number }).count;
}

function hasObjectField(json: string, field: string): boolean {
  const parsed = JSON.parse(json) as Record<string, unknown>;
  return typeof parsed[field] === "object" && parsed[field] !== null;
}
