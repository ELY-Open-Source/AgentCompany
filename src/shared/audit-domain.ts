export interface AuditReplayRunRecord {
  id: string;
  orgId: string;
  threadId: string;
  eventCount: number;
  eventDigest: string;
  replayJson: string;
  createdByEmployeeId: string | null;
  createdAt: string;
}
