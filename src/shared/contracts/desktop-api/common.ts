export type DesktopResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export interface SaveTaskResult {
  id: string;
  capabilityWarning?: string;
}

export interface ConfigRevisionSummary {
  id: string;
  agentId: string;
  revisionNumber: number;
  changedKeys: string[];
  source: string;
  rolledBackFromRevisionId: string | null;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  createdAt: string;
}

export interface ConfigRevisionDetail extends ConfigRevisionSummary {
  configBefore: Record<string, unknown>;
  configAfter: Record<string, unknown>;
}

export interface RunEventRecord {
  id: number;
  runId: string;
  agentId: string;
  seq: number;
  eventType: string;
  stream: string | null;
  level: string | null;
  message: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface HeartbeatPolicy {
  enabled: boolean;
  intervalSec: number;
  cooldownSec: number;
  maxConcurrentRuns: number;
  wakeOnDemand: boolean;
}
