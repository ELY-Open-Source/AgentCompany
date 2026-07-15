import type { BrowserWindow } from "electron";
import type { DatabaseConnection } from "../database/connection";
import { IPC_CHANNELS } from "../../shared/ipc";
import { expireStaleChatWakes } from "../services/chat-agent-wake-service";
import { OrganizationService } from "../services/organization-service";
import { spawnGoalReviews } from "../services/goal-review-service";
import { TaskExecutionService } from "../services/task-execution-service";

const DEFAULT_INTERVAL_MS = 5_000;

export interface TaskQueueWorkerInput {
  connection: DatabaseConnection;
  mainWindow: BrowserWindow;
  intervalMs?: number;
}

export interface QueuedRun {
  id: string;
  org_id: string;
}

/** True while the operator has pulled the global autonomous handbrake. */
export function isAutonomousPaused(connection: DatabaseConnection): boolean {
  const row = connection.db.prepare("select autorun_paused from app_state where id = 1")
    .get() as { autorun_paused: number } | undefined;
  return row?.autorun_paused === 1;
}

/**
 * Atomically claims the oldest queued task_run by transitioning it
 * `queued` -> `running` in one transaction; returns the claimed run or null.
 * Runs whose provider sits in a transient-failure cooldown are left queued —
 * they would fail on arrival, and waiting costs nothing.
 */
export function claimNextQueuedRun(connection: DatabaseConnection, excludedProviderIds: string[] = []): QueuedRun | null {
  return connection.transaction(() => {
    const exclusion = excludedProviderIds.length > 0
      ? `and provider_id not in (${excludedProviderIds.map(() => "?").join(", ")})`
      : "";
    const row = connection.db
      .prepare(`select id, org_id from task_runs where state = 'queued' ${exclusion} order by created_at asc limit 1`)
      .get(...excludedProviderIds) as QueuedRun | undefined;
    if (!row) return null;
    const result = connection.db
      .prepare("update task_runs set state = 'running', started_at = coalesce(started_at, ?) where id = ? and state = 'queued'")
      .run(new Date().toISOString(), row.id);
    return result.changes === 1 ? row : null;
  });
}

/**
 * Autonomous executor: every tick it claims the oldest `queued` task_run (the
 * bootstrap CEO run, plus any future heartbeat-created runs) and executes its
 * real agent loop. The claim is a single transaction (`queued` -> `running`,
 * verified by row changes) so a run is never executed twice.
 */
export function startTaskQueueWorker(input: TaskQueueWorkerInput): () => void {
  const notifyDataChanged = () => {
    if (!input.mainWindow.isDestroyed()) {
      input.mainWindow.webContents.send(IPC_CHANNELS.rendererEvent, { type: "snapshot-changed" });
    }
  };
  const taskExecution = new TaskExecutionService(input.connection.db, undefined, undefined, notifyDataChanged);
  const organization = new OrganizationService(input.connection.db);
  const intervalMs = input.intervalMs ?? DEFAULT_INTERVAL_MS;
  let running = false;
  let wasPaused = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      // The operator's global pause parks the whole engine: nothing new is
      // enqueued or claimed until they resume. Queued work simply waits.
      const paused = isAutonomousPaused(input.connection);
      if (paused !== wasPaused) {
        console.info(paused ? "[task-queue] paused by the operator; no new runs start." : "[task-queue] resumed by the operator.");
        wasPaused = paused;
      }
      if (paused) return;
      // Stale conversation wakes die before anything is claimed: replying to
      // a thread hours later is noise, and a backlog of them would starve
      // fresh messages (the founder's included) for the whole grind.
      const expired = input.connection.transaction(() => expireStaleChatWakes(input.connection.db, new Date().toISOString()));
      if (expired > 0) {
        console.info(`[task-queue] expired ${expired} stale chat wake run(s); newer messages re-wake their agents.`);
        notifyDataChanged();
      }
      // Goal checkpoints first, so a review task created this tick is
      // eligible for the same tick's heartbeat enqueue below.
      const reviews = input.connection.transaction(() => spawnGoalReviews(input.connection.db, organization));
      if (reviews.length > 0) notifyDataChanged();
      const enqueued = input.connection.transaction(() => taskExecution.enqueueHeartbeatRuns());
      const claimed = claimNextQueuedRun(input.connection, taskExecution.cooledProviderIds());
      if (!claimed) {
        if (enqueued.length > 0) notifyDataChanged();
        return;
      }
      notifyDataChanged();
      try {
        await taskExecution.executeRun(claimed.org_id, claimed.id);
      } catch {
        // executeRun records the failure on the run row; the UI reflects it below.
      }
      notifyDataChanged();
    } finally {
      running = false;
    }
  };

  const interval = setInterval(() => {
    void tick();
  }, intervalMs);
  void tick();
  return () => clearInterval(interval);
}
