import type {
  ComplianceExportType,
  ComplianceSubjectType,
  LegalHoldEntityType,
  RetentionFreezeScopeType,
} from "../domain";

export interface CreateMigrationReportInput {
  orgId: string;
  sourceDatabasePath: string;
}

export interface CreateRollbackSnapshotInput {
  orgId: string;
  migrationReportId: string;
  createdByEmployeeId: string;
}

export interface SetRollbackSnapshotActiveInput {
  orgId: string;
  snapshotId: string;
  active: boolean;
  employeeId: string;
}

export interface ResolveMigrationReconciliationInput {
  orgId: string;
  reconciliationItemId: string;
  employeeId: string;
}

export interface CreateComplianceExportInput {
  orgId: string;
  subjectType: ComplianceSubjectType;
  subjectId: string;
  exportType: ComplianceExportType;
  requestedByEmployeeId: string;
}

export interface CreateLegalHoldInput {
  orgId: string;
  entityType: LegalHoldEntityType;
  entityId: string;
  reason: string;
  createdByEmployeeId: string;
}

export interface SetLegalHoldStateInput {
  orgId: string;
  legalHoldId: string;
  active: boolean;
  employeeId: string;
}

export interface CreateRetentionFreezeInput {
  orgId: string;
  scopeType: RetentionFreezeScopeType;
  scopeId: string;
  reason: string;
  createdByEmployeeId: string;
}

export interface SetRetentionFreezeStateInput {
  orgId: string;
  retentionFreezeId: string;
  active: boolean;
  employeeId: string;
}

export interface SetFeatureFlagInput {
  orgId: string;
  flagId: string;
  enabled: boolean;
}
