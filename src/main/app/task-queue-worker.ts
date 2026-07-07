import type { BrowserWindow } from "electron";
import type { DatabaseConnection } from "../database/connection";
import { IPC_CHANNELS } from "../../shared/ipc";
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

/**
 * Atomically claims the oldest queued task_run by transitioning it
 * `queued` -> `running` in one transaction; returns the claimed run or null.
 */
export function claimNextQueuedRun(connection: DatabaseConnection): QueuedRun | null {
  return connection.transaction(() => {
    const row = connection.db
      .prepare("select id, org_id from task_runs where state = 'queued' order by created_at asc limit 1")
      .get() as QueuedRun | undefined;
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
  const intervalMs = input.intervalMs ?? DEFAULT_INTERVAL_MS;
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const enqueued = input.connection.transaction(() => taskExecution.enqueueHeartbeatRuns());
      const claimed = claimNextQueuedRun(input.connection);
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
