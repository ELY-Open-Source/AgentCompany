import type { DatabaseSync } from "node:sqlite";
import { createId } from "../../shared/ids";

const REPLAYABLE_ENTITY_TYPES = new Set([
  "agent",
  "approval",
  "browser_action",
  "chat_message",
  "chat_space",
  "file",
  "scheduled_post",
  "social_account",
  "task",
  "workspace",
]);

export interface CutoverDeltaEvent {
  id: string;
  entityType: string;
  entityId: string;
  actorType: string;
  actorId: string | null;
  action: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface RecordCutoverEventInput {
  orgId: string;
  migrationReportId: string;
  rollbackSnapshotId: string | null;
  eventType: string;
  actorType: string;
  actorId: string | null;
  payload: Record<string, unknown>;
  createdAt?: string;
}

export class MigrationCutoverJournalService {
  constructor(private readonly db: DatabaseSync) {}

  recordEvent(input: RecordCutoverEventInput): string {
    const id = createId("mce");
    this.db.prepare(`
      insert into migration_cutover_events(
        id, org_id, migration_report_id, rollback_snapshot_id, event_type,
        actor_type, actor_id, payload_json, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.orgId,
      input.migrationReportId,
      input.rollbackSnapshotId,
      input.eventType,
      input.actorType,
      input.actorId,
      JSON.stringify(input.payload),
      input.createdAt ?? new Date().toISOString(),
    );
    return id;
  }

  queueReconciliation(input: {
    orgId: string;
    migrationReportId: string;
    rollbackSnapshotId: string;
    events: CutoverDeltaEvent[];
    createdAt?: string;
  }): number {
    let queued = 0;
    const createdAt = input.createdAt ?? new Date().toISOString();
    const statement = this.db.prepare(`
      insert or ignore into migration_reconciliation_items(
        id, org_id, migration_report_id, rollback_snapshot_id, source_event_id,
        target_type, target_id, reason, state, payload_json, created_at, resolved_at, resolved_by_employee_id
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, null)
    `);
    for (const event of input.events) {
      if (!REPLAYABLE_ENTITY_TYPES.has(event.entityType)) continue;
      const result = statement.run(
        createId("mri"),
        input.orgId,
        input.migrationReportId,
        input.rollbackSnapshotId,
        event.id,
        event.entityType,
        event.entityId,
        "manual_delta_replay",
        "open",
        JSON.stringify({
          action: event.action,
          actorType: event.actorType,
          actorId: event.actorId,
          payload: event.payload,
          createdAt: event.createdAt,
        }),
        createdAt,
      );
      queued += Number(result.changes);
    }
    return queued;
  }
}
