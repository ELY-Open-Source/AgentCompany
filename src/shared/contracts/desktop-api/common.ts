export type DesktopResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export interface SaveTaskResult {
  id: string;
  capabilityWarning?: string;
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
