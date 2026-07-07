export interface RollbackSnapshotRecord {
  id: string;
  orgId: string;
  migrationReportId: string;
  sourceDatabasePath: string;
  sourceFingerprint: string;
  sourceDatabaseSha256: string;
  workspaceManifestJson: string;
  workspaceManifestSha256: string;
  deltaJournalJson: string;
  restorePlanJson: string;
  active: boolean;
  createdByEmployeeId: string | null;
  createdAt: string;
  activatedAt: string | null;
}

export interface MigrationCutoverEventRecord {
  id: string;
  orgId: string;
  migrationReportId: string;
  rollbackSnapshotId: string | null;
  eventType: string;
  actorType: string;
  actorId: string | null;
  payloadJson: string;
  createdAt: string;
}

export interface MigrationReconciliationItemRecord {
  id: string;
  orgId: string;
  migrationReportId: string;
  rollbackSnapshotId: string | null;
  sourceEventId: string;
  targetType: string;
  targetId: string;
  reason: string;
  state: string;
  payloadJson: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedByEmployeeId: string | null;
}
