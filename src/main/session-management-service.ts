import type { AppDatabase } from "./database";
import { getConnectorDefinition } from "./connectors";
import type { ConnectorId, TaskSessionRecord } from "@shared/types";

interface SessionManagementDependencies {
  db: AppDatabase;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

// D-01/D-02: Exported for testing and external override. Conservative defaults.
export const DEFAULT_THRESHOLDS = {
  maxRuns: 20,
  maxTokens: 500_000,
  maxAgeHours: 72,
};

// D-01: Type for per-adapter or company-level threshold overrides
export type RotationThresholds = Partial<typeof DEFAULT_THRESHOLDS>;

// D-04: Handoff size cap to prevent prompt bloat
const MAX_HANDOFF_LENGTH = 2000;
const MAX_HANDOFF_RUNS = 5;

export function createSessionManagementService({ db, logger }: SessionManagementDependencies) {

  // D-08: Accumulate token usage on task_sessions row (called for ALL adapters per D-05)
  function accumulateTokenUsage(sessionId: string, inputTokens: number, outputTokens: number, runId: string): void {
    db.incrementSessionUsage(sessionId, inputTokens, outputTokens, runId);
  }

  // D-01: Any-of thresholds with optional overrides. D-04: Check nativeContextManagement.
  // Per D-01: "Configurable per-adapter with company-level overrides" -- accepts optional
  // thresholds parameter that merges with defaults. Callers can pass per-adapter or
  // company-level overrides; omitted fields fall back to DEFAULT_THRESHOLDS.
  function evaluateRotation(
    session: TaskSessionRecord,
    connectorId: string,
    thresholdsOverride?: RotationThresholds,
  ): { shouldRotate: boolean; reason: string | null } {
    // D-04: Check adapter exemption
    try {
      const connector = getConnectorDefinition(connectorId as ConnectorId);
      if (connector.module.nativeContextManagement === true) {
        return { shouldRotate: false, reason: null };
      }
    } catch {
      // Unknown connector - proceed with rotation check
    }

    // Merge overrides with defaults (per D-01 configurability)
    const thresholds = { ...DEFAULT_THRESHOLDS, ...thresholdsOverride };

    // D-01: Any-of thresholds - first trigger wins
    if (session.runCount >= thresholds.maxRuns) {
      return { shouldRotate: true, reason: "max_runs" };
    }

    const totalTokens = session.totalInputTokens + session.totalOutputTokens;
    if (totalTokens >= thresholds.maxTokens) {
      return { shouldRotate: true, reason: "max_tokens" };
    }

    const ageMs = Date.now() - new Date(session.createdAt).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    if (ageHours >= thresholds.maxAgeHours) {
      return { shouldRotate: true, reason: "max_age_hours" };
    }

    return { shouldRotate: false, reason: null };
  }

  // D-06: Build handoff markdown from structured data, no AI call
  function generateHandoff(taskId: string, session: TaskSessionRecord): string {
    let task: { title: string; description: string } | null = null;
    try {
      task = db.getTask(taskId);
    } catch {
      task = null;
    }

    const recentRuns = db.getRecentRunsForTask(taskId, MAX_HANDOFF_RUNS);
    const errorRuns = recentRuns.filter(r => r.errorMessage);
    const activityEntries = db.getRecentActivityForTask(taskId, 10);
    const decisionEntries = activityEntries.filter(a =>
      a.action.includes("decision") || a.action.includes("approval") || a.action.includes("resolved")
    );

    const sections: string[] = [];

    sections.push("# Session Handoff");
    sections.push("");

    if (task) {
      sections.push("## Task");
      sections.push(`**${task.title}**`);
      const descSnippet = task.description.length > 200 ? task.description.slice(0, 200) + "..." : task.description;
      sections.push(descSnippet);
      sections.push("");
    }

    if (recentRuns.length > 0) {
      sections.push("## Recent Run History");
      for (const run of recentRuns) {
        const summaryText = run.summary ? run.summary.slice(0, 100) : "(no summary)";
        sections.push(`- [${run.status}] ${summaryText} (${run.finishedAt ?? "in progress"})`);
      }
      sections.push("");
    }

    if (errorRuns.length > 0) {
      sections.push("## Errors Encountered");
      for (const run of errorRuns) {
        sections.push(`- ${run.errorMessage!.slice(0, 150)} (${run.finishedAt ?? "unknown"})`);
      }
      sections.push("");
    }

    if (decisionEntries.length > 0) {
      sections.push("## Key Decisions");
      for (const entry of decisionEntries.slice(0, 5)) {
        sections.push(`- ${entry.detail.slice(0, 120)} (${entry.createdAt})`);
      }
      sections.push("");
    }

    sections.push(`*Session stats: ${session.runCount} runs, ${session.totalInputTokens + session.totalOutputTokens} total tokens*`);

    let result = sections.join("\n");
    // Cap handoff size per research pitfall #5
    if (result.length > MAX_HANDOFF_LENGTH) {
      result = result.slice(0, MAX_HANDOFF_LENGTH - 50) + "\n\n... (earlier content omitted)";
    }
    return result;
  }

  // Archive current session, generate handoff, create new session, update task pointer
  function rotateSession(session: TaskSessionRecord): string {
    const reason = "threshold_exceeded";
    const handoff = generateHandoff(session.taskId, session);

    logger.info(`[session] Rotating session ${session.id} for task ${session.taskId}: ${reason}`);

    // 1. Archive old session
    db.archiveSession(session.id, reason, handoff);

    // 2. Create new session row with fresh counters, carry forward session_params
    const newSessionId = db.createNewSession({
      taskId: session.taskId,
      companyId: session.companyId,
      agentId: session.agentId,
      adapterType: session.adapterType,
      sessionParamsJson: session.sessionParamsJson,
      sessionDisplayId: session.sessionDisplayId,
    });

    logger.info(`[session] New session ${newSessionId} created for task ${session.taskId}`);
    return newSessionId;
  }

  // D-07: Read handoff from most recently rotated session for a task
  function getHandoffContext(taskId: string): string | null {
    // Find the most recent archived session for this task (the one just before current)
    const row = db.queryAll<{ handoffMarkdown: string | null }>(
      `SELECT handoff_markdown as handoffMarkdown FROM task_sessions
       WHERE task_id = ? AND rotated_at IS NOT NULL
       ORDER BY rotated_at DESC LIMIT 1`,
      taskId
    );
    return row[0]?.handoffMarkdown ?? null;
  }

  // D-09: Snapshot token totals for delta tracking
  function snapshotUsage(session: TaskSessionRecord): { inputTokens: number; outputTokens: number } {
    return {
      inputTokens: session.totalInputTokens,
      outputTokens: session.totalOutputTokens,
    };
  }

  // D-09: Compute delta from snapshot
  function getUsageDelta(
    sessionId: string,
    snapshot: { inputTokens: number; outputTokens: number }
  ): { inputTokensDelta: number; outputTokensDelta: number } {
    // Re-read current totals from DB
    const current = db.queryAll<{ totalInputTokens: number; totalOutputTokens: number }>(
      `SELECT total_input_tokens as totalInputTokens, total_output_tokens as totalOutputTokens
       FROM task_sessions WHERE id = ?`,
      sessionId
    );
    if (!current[0]) return { inputTokensDelta: 0, outputTokensDelta: 0 };
    return {
      inputTokensDelta: current[0].totalInputTokens - snapshot.inputTokens,
      outputTokensDelta: current[0].totalOutputTokens - snapshot.outputTokens,
    };
  }

  return {
    accumulateTokenUsage,
    evaluateRotation,
    generateHandoff,
    rotateSession,
    getHandoffContext,
    snapshotUsage,
    getUsageDelta,
  };
}
