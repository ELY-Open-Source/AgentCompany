import type { DatabaseSync } from "node:sqlite";
import type { SetFeatureFlagInput } from "../../shared/commands";
import { FEATURE_FLAG_KEY, SLO_SIGNAL_KEY, type FeatureFlagKey, type SloSignalKey } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";

const FEATURE_FLAGS = [
  { key: FEATURE_FLAG_KEY.PROVIDER_BACKGROUND_EXECUTION, label: "Provider background execution", enabled: true },
  { key: FEATURE_FLAG_KEY.SOCIAL_PUBLISH_APPROVAL, label: "Social publish approval", enabled: true },
  { key: FEATURE_FLAG_KEY.BOARD_INTERVENTION, label: "Board intervention", enabled: true },
] as const;

const SLO_TARGETS = [
  { signalKey: SLO_SIGNAL_KEY.PROVIDER_REQUEST_SUCCESS, label: "Provider requests", targetBasisPoints: 9950, windowMinutes: 43200 },
  { signalKey: SLO_SIGNAL_KEY.APPROVAL_ROUTE_COVERAGE, label: "Approval routing", targetBasisPoints: 10000, windowMinutes: 43200 },
  { signalKey: SLO_SIGNAL_KEY.BROWSER_SESSION_BOUNDARY, label: "Browser session boundary", targetBasisPoints: 10000, windowMinutes: 43200 },
  { signalKey: SLO_SIGNAL_KEY.SKILL_RESOLVE_SUCCESS, label: "Skill resolve", targetBasisPoints: 9950, windowMinutes: 43200 },
  { signalKey: SLO_SIGNAL_KEY.MIGRATION_VALIDATION_SUCCESS, label: "Migration validation", targetBasisPoints: 10000, windowMinutes: 43200 },
] as const;

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
}
