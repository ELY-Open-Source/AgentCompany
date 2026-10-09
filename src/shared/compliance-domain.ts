export const COMPLIANCE_EXPORT_TYPE = {
  GDPR_EXPORT: "gdpr_export",
  GDPR_DELETE: "gdpr_delete",
} as const;

export const COMPLIANCE_EXPORT_STATE = {
  COMPLETED: "completed",
} as const;

type ValueOf<T> = T[keyof T];

export type ComplianceExportType = ValueOf<typeof COMPLIANCE_EXPORT_TYPE>;
export type ComplianceExportState = ValueOf<typeof COMPLIANCE_EXPORT_STATE>;
export type ComplianceSubjectType = "employee" | "agent";
export type LegalHoldEntityType = "organization" | "employee" | "agent" | "chat_thread" | "file_object";
export type RetentionFreezeScopeType = "organization" | "chat_space" | "file_object";

export interface ComplianceExportRecord {
  id: string;
  orgId: string;
  subjectType: ComplianceSubjectType;
  subjectId: string;
  exportType: ComplianceExportType;
  state: ComplianceExportState;
  payloadJson: string;
  requestedByEmployeeId: string | null;
  createdAt: string;
  completedAt: string | null;
}

