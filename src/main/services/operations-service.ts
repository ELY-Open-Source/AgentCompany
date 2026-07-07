import type { DatabaseSync } from "node:sqlite";
import type { RunChaosDrillInput, SetFeatureFlagInput } from "../../shared/commands";
import {
  CHAOS_DRILL_SCENARIO,
  CHAOS_DRILL_STATE,
  FEATURE_FLAG_KEY,
  SLO_SIGNAL_KEY,
  type ChaosDrillScenario,
  type FeatureFlagKey,
  type SloSignalKey,
} from "../../shared/domain";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";

const FEATURE_FLAGS = [
  { key: FEATURE_FLAG_KEY.PROVIDER_BACKGROUND_EXECUTION, label: "Provider background execution", enabled: true },
  { key: FEATURE_FLAG_KEY.SOCIAL_PUBLISH_APPROVAL, label: "Social publish approval", enabled: true },
  { key: FEATURE_FLAG_KEY.BOARD_INTERVENTION, label: "Board intervention", enabled: true },
  { key: FEATURE_FLAG_KEY.CHAOS_DRILLS, label: "Chaos drills", enabled: true },
] as const;

const SLO_TARGETS = [
  { signalKey: SLO_SIGNAL_KEY.PROVIDER_REQUEST_SUCCESS, label: "Provider requests", targetBasisPoints: 9950, windowMinutes: 43200 },
  { signalKey: SLO_SIGNAL_KEY.APPROVAL_ROUTE_COVERAGE, label: "Approval routing", targetBasisPoints: 10000, windowMinutes: 43200 },
  { signalKey: SLO_SIGNAL_KEY.BROWSER_SESSION_BOUNDARY, label: "Browser session boundary", targetBasisPoints: 10000, windowMinutes: 43200 },
  { signalKey: SLO_SIGNAL_KEY.SKILL_RESOLVE_SUCCESS, label: "Skill resolve", targetBasisPoints: 9950, windowMinutes: 43200 },
  { signalKey: SLO_SIGNAL_KEY.MIGRATION_VALIDATION_SUCCESS, label: "Migration validation", targetBasisPoints: 10000, windowMinutes: 43200 },
] as const;

const CHAOS_DRILLS = [
  { key: "provider-outage-policy", label: "Provider outage policy", scenarioKey: CHAOS_DRILL_SCENARIO.PROVIDER_OUTAGE_POLICY_GATE },
  { key: "approval-backlog-routing", label: "Approval backlog routing", scenarioKey: CHAOS_DRILL_SCENARIO.APPROVAL_BACKLOG_GATE },
  { key: "browser-session-boundary", label: "Browser session boundary", scenarioKey: CHAOS_DRILL_SCENARIO.BROWSER_SESSION_BOUNDARY },
  { key: "migration-rollback-pack", label: "Migration rollback pack", scenarioKey: CHAOS_DRILL_SCENARIO.MIGRATION_ROLLBACK_PACK },
] as const;

interface DrillOutcome {
  success: boolean;
  checks: Record<string, number | boolean | string>;
}

interface ChaosDrillRow {
  id: string;
  scenario_key: ChaosDrillScenario;
  enabled: number;
}

export class OperationsService {
  private readonly audit: AuditService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
  }

  seedOrganizationOperations(orgId: string, now: string): void {
    for (const flag of FEATURE_FLAGS) {
      this.db.prepare(`
        insert into feature_flags(id, org_id, key, label, enabled, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?)
        on conflict(org_id, key) do nothing
      `).run(createId("ffg"), orgId, flag.key, flag.label, flag.enabled ? 1 : 0, now, now);
    }
    for (const target of SLO_TARGETS) {
      this.db.prepare(`
        insert into slo_targets(id, org_id, signal_key, label, target_basis_points, window_minutes, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(org_id, signal_key) do nothing
      `).run(createId("slo"), orgId, target.signalKey, target.label, target.targetBasisPoints, target.windowMinutes, now, now);
    }
    for (const drill of CHAOS_DRILLS) {
      this.db.prepare(`
        insert into chaos_drills(id, org_id, key, label, scenario_key, enabled, created_at, updated_at)
        values (?, ?, ?, ?, ?, 1, ?, ?)
        on conflict(org_id, key) do nothing
      `).run(createId("cdr"), orgId, drill.key, drill.label, drill.scenarioKey, now, now);
    }
  }

  setFeatureFlag(input: SetFeatureFlagInput): void {
    const flag = this.db.prepare("select key from feature_flags where id = ? and org_id = ?")
      .get(input.flagId, input.orgId) as { key: FeatureFlagKey } | undefined;
    if (!flag) throw new Error("Feature flag was not found.");
    const now = new Date().toISOString();
    const result = this.db.prepare("update feature_flags set enabled = ?, updated_at = ? where id = ? and org_id = ?")
      .run(input.enabled ? 1 : 0, now, input.flagId, input.orgId);
    if (result.changes === 0) throw new Error("Feature flag was not found.");
    this.audit.record({
      orgId: input.orgId,
      entityType: "feature_flag",
      entityId: input.flagId,
      actorType: "system",
      actorId: null,
      action: "updated",
      payload: { key: flag.key, enabled: input.enabled },
    });
  }

  runChaosDrill(input: RunChaosDrillInput): string {
    if (!this.isFeatureEnabled(input.orgId, FEATURE_FLAG_KEY.CHAOS_DRILLS)) throw new Error("Chaos drills are disabled.");
    const drill = this.db.prepare("select id, scenario_key, enabled from chaos_drills where id = ? and org_id = ?")
      .get(input.drillId, input.orgId) as ChaosDrillRow | undefined;
    if (!drill) throw new Error("Chaos drill was not found.");
    if (drill.enabled !== 1) throw new Error("Chaos drill is disabled.");
    const startedAt = new Date().toISOString();
    const outcome = this.evaluateScenario(input.orgId, drill.scenario_key);
    const runId = createId("cdrun");
    const completedAt = new Date().toISOString();
    this.db.prepare(`
      insert into chaos_drill_runs(id, org_id, drill_id, state, result_json, started_at, completed_at)
      values (?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      input.orgId,
      input.drillId,
      outcome.success ? CHAOS_DRILL_STATE.PASSED : CHAOS_DRILL_STATE.FAILED,
      JSON.stringify(outcome.checks),
      startedAt,
      completedAt,
    );
    this.recordSignal({
      orgId: input.orgId,
      signalKey: this.signalForScenario(drill.scenario_key),
      source: "chaos_drill",
      success: outcome.success,
      durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
      detail: { drillId: input.drillId, scenarioKey: drill.scenario_key },
    });
    this.audit.record({
      orgId: input.orgId,
      entityType: "chaos_drill",
      entityId: input.drillId,
      actorType: "system",
      actorId: null,
      action: "run",
      payload: { runId, state: outcome.success ? CHAOS_DRILL_STATE.PASSED : CHAOS_DRILL_STATE.FAILED },
    });
    return runId;
  }

  isFeatureEnabled(orgId: string, key: FeatureFlagKey): boolean {
    const row = this.db.prepare("select enabled from feature_flags where org_id = ? and key = ?")
      .get(orgId, key) as { enabled: number } | undefined;
    if (!row) throw new Error("Feature flag is required.");
    return row.enabled === 1;
  }

  recordSignal(input: {
    orgId: string;
    signalKey: SloSignalKey;
    source: string;
    success: boolean;
    durationMs: number | null;
    detail: unknown;
  }): void {
    this.db.prepare(`
      insert into operational_events(id, org_id, signal_key, source, success, duration_ms, detail_json, created_at)
      values (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      createId("ope"),
      input.orgId,
      input.signalKey,
      input.source,
      input.success ? 1 : 0,
      input.durationMs,
      JSON.stringify(input.detail),
      new Date().toISOString(),
    );
  }

  private evaluateScenario(orgId: string, scenario: ChaosDrillScenario): DrillOutcome {
    if (scenario === CHAOS_DRILL_SCENARIO.PROVIDER_OUTAGE_POLICY_GATE) return this.providerOutagePolicyGate(orgId);
    if (scenario === CHAOS_DRILL_SCENARIO.APPROVAL_BACKLOG_GATE) return this.approvalBacklogGate(orgId);
    if (scenario === CHAOS_DRILL_SCENARIO.BROWSER_SESSION_BOUNDARY) return this.browserSessionBoundary(orgId);
    if (scenario === CHAOS_DRILL_SCENARIO.MIGRATION_ROLLBACK_PACK) return this.migrationRollbackPack(orgId);
    throw new Error("Chaos drill scenario is invalid.");
  }

  private providerOutagePolicyGate(orgId: string): DrillOutcome {
    const total = count(this.db, "select count(*) as count from providers where org_id = ?", orgId);
    const policyConflicts = count(this.db, `
      select count(*) as count
      from providers
      where org_id = ? and data_policy = 'zero_data_retention' and background_enabled = 1
    `, orgId);
    const invalidLimits = count(this.db, "select count(*) as count from providers where org_id = ? and monthly_request_limit < 1", orgId);
    return {
      success: total > 0 && policyConflicts === 0 && invalidLimits === 0,
      checks: { providers: total, policyConflicts, invalidLimits },
    };
  }

  private approvalBacklogGate(orgId: string): DrillOutcome {
    const routes = count(this.db, "select count(*) as count from approval_routing_rules where org_id = ?", orgId);
    const unassigned = count(this.db, `
      select count(*) as count
      from approvals
      where org_id = ? and id not in (
        select approval_id from approval_assignments where org_id = ?
      )
    `, orgId, orgId);
    return { success: routes > 0 && unassigned === 0, checks: { routes, unassignedApprovals: unassigned } };
  }

  private browserSessionBoundary(orgId: string): DrillOutcome {
    const accounts = count(this.db, "select count(*) as count from social_accounts where org_id = ?", orgId);
    const grants = count(this.db, "select count(*) as count from social_account_grants where org_id = ?", orgId);
    const actions = count(this.db, "select count(*) as count from browser_actions where org_id = ?", orgId);
    return { success: grants >= accounts, checks: { accounts, grants, actions } };
  }

  private migrationRollbackPack(orgId: string): DrillOutcome {
    const reports = this.db.prepare("select report_json from migration_reports where org_id = ?").all(orgId) as Array<{ report_json: string }>;
    const complete = reports.filter((report) => hasRollbackPack(report.report_json)).length;
    return { success: reports.length === complete, checks: { reports: reports.length, rollbackPacks: complete } };
  }

  private signalForScenario(scenario: ChaosDrillScenario): SloSignalKey {
    if (scenario === CHAOS_DRILL_SCENARIO.PROVIDER_OUTAGE_POLICY_GATE) return SLO_SIGNAL_KEY.PROVIDER_REQUEST_SUCCESS;
    if (scenario === CHAOS_DRILL_SCENARIO.APPROVAL_BACKLOG_GATE) return SLO_SIGNAL_KEY.APPROVAL_ROUTE_COVERAGE;
    if (scenario === CHAOS_DRILL_SCENARIO.BROWSER_SESSION_BOUNDARY) return SLO_SIGNAL_KEY.BROWSER_SESSION_BOUNDARY;
    if (scenario === CHAOS_DRILL_SCENARIO.MIGRATION_ROLLBACK_PACK) return SLO_SIGNAL_KEY.MIGRATION_VALIDATION_SUCCESS;
    throw new Error("Chaos drill scenario is invalid.");
  }
}

function count(db: DatabaseSync, sql: string, ...params: string[]): number {
  return (db.prepare(sql).get(...params) as { count: number }).count;
}

function hasRollbackPack(reportJson: string): boolean {
  const parsed = JSON.parse(reportJson) as { rollbackPack?: unknown };
  return typeof parsed.rollbackPack === "object" && parsed.rollbackPack !== null;
}
