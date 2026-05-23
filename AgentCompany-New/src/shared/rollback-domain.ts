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
