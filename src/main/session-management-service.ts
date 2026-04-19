import type { AppDatabase } from "./database";
import type { TaskSessionRecord } from "@shared/types";

interface SessionManagementDependencies {
  db: AppDatabase;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

// Rotation thresholds. Any-of semantics — first trigger wins.
const ROTATION_THRESHOLDS = {
  maxRuns: 20,
  maxTokens: 500_000,
  maxAgeHours: 72,
};

// D-04: Handoff size cap to prevent prompt bloat.
// 2000 characters ≈ 500 tokens — enough to resume context without crowding
// out the system prompt + user message in an 8k-ish model window.
const MAX_HANDOFF_LENGTH = 2000;
// 5 runs of resume context is typically enough to bridge a rotation boundary;
// older runs add diminishing value relative to the token cost.
const MAX_HANDOFF_RUNS = 5;

export function createSessionManagementService({ db, logger }: SessionManagementDependencies) {

  // D-08: Accumulate token usage on task_sessions row (called for ALL adapters per D-05)
  function accumulateTokenUsage(sessionId: string, inputTokens: number, outputTokens: number, runId: string): void {
    db.incrementSessionUsage(sessionId, inputTokens, outputTokens, runId);
  }

  // Any-of thresholds — first trigger wins. Pi-mono delegates context
  // management to pi-agent-core compaction hooks; AgentCompany applies its
  // own rotation thresholds on top of that.
  function evaluateRotation(
    session: TaskSessionRecord,
  ): { shouldRotate: boolean; reason: string | null } {
    if (session.runCount >= ROTATION_THRESHOLDS.maxRuns) {
      return { shouldRotate: true, reason: "max_runs" };
    }

    const totalTokens = session.totalInputTokens + session.totalOutputTokens;
    if (totalTokens >= ROTATION_THRESHOLDS.maxTokens) {
      return { shouldRotate: true, reason: "max_tokens" };
    }

    const ageMs = Date.now() - new Date(session.createdAt).getTime();
    const ageHours = ageMs / (1000 * 60 * 60);
    if (ageHours >= ROTATION_THRESHOLDS.maxAgeHours) {
      return { shouldRotate: true, reason: "max_age_hours" };
    }

    return { shouldRotate: false, reason: null };
  }

  // D-06: Build handoff markdown from structured data, no AI call.
  //
  // Sessions are agent-scoped (post-v34 migration). The handoff walks the
  // agent's recent runs across ALL tasks and taskless heartbeats — heartbeat
  // runs legitimately have no task but still need a handoff when their
  // transcript rotates under token pressure.
  function generateHandoff(session: TaskSessionRecord): string {
    const recentRuns = db.queryAll<{
      id: string; status: string; summary: string | null; errorMessage: string | null;
      finishedAt: string | null; taskId: string | null; taskTitle: string | null;
    }>(
      `SELECT r.id, r.status, r.summary, r.error_message as errorMessage,
              r.finished_at as finishedAt, r.task_id as taskId,
              t.title as taskTitle
         FROM runs r LEFT JOIN tasks t ON t.id = r.task_id
        WHERE r.agent_id = ? AND r.company_id = ? AND r.finished_at IS NOT NULL
        ORDER BY r.finished_at DESC LIMIT ?`,
      session.agentId,
      session.companyId,
      MAX_HANDOFF_RUNS,
    );
    const errorRuns = recentRuns.filter((r) => r.errorMessage);

    const decisionEntries = db.queryAll<{ action: string; detail: string; createdAt: string }>(
      `SELECT action, detail, created_at as createdAt FROM activity
         WHERE company_id = ? AND actor = ?
           AND (action LIKE '%decision%' OR action LIKE '%approval%' OR action LIKE '%resolved%')
         ORDER BY created_at DESC LIMIT 5`,
      session.companyId,
      session.agentId,
    );

    const sections: string[] = [];
    sections.push("# Session Handoff");
    sections.push("");

    if (recentRuns.length > 0) {
      sections.push("## Recent Run History");
      for (const run of recentRuns) {
        const summaryText = run.summary ? run.summary.slice(0, 100) : "(no summary)";
        const scope = run.taskTitle ? ` on "${run.taskTitle}"` : " (heartbeat)";
        sections.push(`- [${run.status}]${scope} ${summaryText} (${run.finishedAt ?? "in progress"})`);
      }
      sections.push("");
    }

    if (errorRuns.length > 0) {
      sections.push("## Errors Encountered");
      for (const run of errorRuns) {
        sections.push(`- ${(run.errorMessage ?? "").slice(0, 150)} (${run.finishedAt ?? "unknown"})`);
      }
      sections.push("");
    }

    if (decisionEntries.length > 0) {
      sections.push("## Key Decisions");
      for (const entry of decisionEntries) {
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

  // Archive current session, generate handoff, create new agent-scoped
  // session, update the agent pointer. Counters reset; Pi Mono carries no
  // provider-side resume state across rotations.
  function rotateSession(session: TaskSessionRecord): string {
    const reason = "threshold_exceeded";
    const handoff = generateHandoff(session);

    logger.info(`[session] Rotating session ${session.id} for agent ${session.agentId}: ${reason}`);

    db.archiveSession(session.id, reason, handoff);

    const newSessionId = db.createNewSession({
      companyId: session.companyId,
      agentId: session.agentId,
      adapterType: session.adapterType,
    });

    db.setAgentSessionId(session.agentId, newSessionId);

    logger.info(`[session] New session ${newSessionId} created for agent ${session.agentId}`);
    return newSessionId;
  }

  // D-07: Read handoff from the agent's most recently rotated session.
  //
  // Sessions are agent-scoped (post-v34 migration), so the handoff query
  // must key on agent_id, not task_id. task_sessions.task_id is now an
  // empty-string column kept only for schema-level backwards compatibility;
  // filtering on it returns zero rows for all rotated agent sessions.
  function getHandoffForAgent(agentId: string): string | null {
    const row = db.queryAll<{ handoffMarkdown: string | null }>(
      `SELECT handoff_markdown as handoffMarkdown FROM task_sessions
       WHERE agent_id = ? AND rotated_at IS NOT NULL
       ORDER BY rotated_at DESC LIMIT 1`,
      agentId,
    );
    return row[0]?.handoffMarkdown ?? null;
  }

  // Task-scoped compatibility shim for callers that still hold a task id
  // (UI panels reading a specific task's handoff history). Resolves the
  // assignee and delegates to the agent-scoped lookup.
  function getHandoffContext(taskId: string): string | null {
    const taskRow = db.queryAll<{ assigneeAgentId: string | null }>(
      "SELECT assignee_agent_id as assigneeAgentId FROM tasks WHERE id = ?",
      taskId,
    );
    const agentId = taskRow[0]?.assigneeAgentId;
    if (!agentId) return null;
    return getHandoffForAgent(agentId);
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
    getHandoffForAgent,
    snapshotUsage,
    getUsageDelta,
  };
}
