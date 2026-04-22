import type { AppDatabase } from "../../database";

interface PersistInput {
  companyId: string;
  runId: string;
  agentId: string;
  eventType: string;
  stream?: "stdout" | "stderr" | null;
  level?: string | null;
  message?: string | null;
  payload?: Record<string, unknown> | null;
}

/**
 * Best-effort `run_events` row writer used by the worker message handler.
 * Failures are logged and swallowed because the run lifecycle must not be
 * gated on audit-log writes.
 */
export function persistRunEvent(
  db: AppDatabase,
  logger: { warn: (...args: unknown[]) => void },
  input: PersistInput,
) {
  try {
    db.core.runs.appendRunEvent(input);
  } catch (error) {
    logger.warn(
      `[run-events] Failed to append ${input.eventType} for ${input.runId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
