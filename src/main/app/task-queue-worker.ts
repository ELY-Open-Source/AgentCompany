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
  /** Injectable execution service so tests can script the provider. */
  taskExecution?: TaskExecutionService;
}

export interface QueuedRun {
  id: string;
  org_id: string;
  provider_id: string | null;
}

/**
 * Which queued runs a claim may take: "interactive" claims only wakes born
 * from a human message (the founder is waiting at the keyboard); "any" claims
 * everything, interactive-first.
 */
export type ClaimLane = "interactive" | "any";

/** True while the operator has pulled the global autonomous handbrake. */
export function isAutonomousPaused(connection: DatabaseConnection): boolean {
  const row = connection.db.prepare("select autorun_paused from app_state where id = 1")
    .get() as { autorun_paused: number } | undefined;
  return row?.autorun_paused === 1;
}

/**
 * Atomically claims the next queued task_run by transitioning it
 * `queued` -> `running` in one transaction; returns the claimed run or null.
 * Runs whose provider sits in a transient-failure cooldown are left queued —
 * they would fail on arrival, and waiting costs nothing.
 *
 * Claim order is interactive-first: a wake triggered by a human message
 * (the founder DMing the CEO, a board member asking in a channel) means a
 * person is waiting at the keyboard, so it outranks any amount of queued
 * autonomous work; within each lane, first come first served. Non-chat runs
 * carry no sourceSenderType and fall into the autonomous lane.
 */
export function claimNextQueuedRun(connection: DatabaseConnection, excludedProviderIds: string[] = [], lane: ClaimLane = "any"): QueuedRun | null {
  return connection.transaction(() => {
    const exclusion = excludedProviderIds.length > 0
      ? `and provider_id not in (${excludedProviderIds.map(() => "?").join(", ")})`
      : "";
    const laneFilter = lane === "interactive"
      ? "and json_extract(secret_scope_json, '$.sourceSenderType') in ('employee', 'board')"
      : "";
    const row = connection.db
      .prepare(`
        select id, org_id, provider_id from task_runs where state = 'queued' ${exclusion} ${laneFilter}
        order by
          case when json_extract(secret_scope_json, '$.sourceSenderType') in ('employee', 'board') then 0 else 1 end asc,
          created_at asc
        limit 1
      `)
      .get(...excludedProviderIds) as QueuedRun | undefined;
    if (!row) return null;
    const result = connection.db
      .prepare("update task_runs set state = 'running', started_at = coalesce(started_at, ?) where id = ? and state = 'queued'")
      .run(new Date().toISOString(), row.id);
    return result.changes === 1 ? row : null;
  });
}

/**
 * Autonomous executor with two execution slots. The autonomous slot grinds
 * the queue one run at a time (bootstrap kickoff, heartbeat work, agent
 * chatter). The interactive slot is reserved capacity for the human: a wake
 * born from an employee or board message executes immediately, concurrently
 * with whatever long autonomous run is in flight — the founder never queues
 * behind batch work. Each claim is a single transaction (`queued` ->
 * `running`, verified by row changes) so a run is never executed twice.
 */
export function startTaskQueueWorker(input: TaskQueueWorkerInput): () => void {
  const notifyDataChanged = () => {
    if (!input.mainWindow.isDestroyed()) {
      input.mainWindow.webContents.send(IPC_CHANNELS.rendererEvent, { type: "snapshot-changed" });
    }
  };
  const taskExecution = input.taskExecution ?? new TaskExecutionService(input.connection.db, undefined, undefined, notifyDataChanged);
  const organization = new OrganizationService(input.connection.db);
  const intervalMs = input.intervalMs ?? DEFAULT_INTERVAL_MS;
  const inFlight = { interactive: false, autonomous: false };
  let wasPaused = false;

  const dispatch = (slot: "interactive" | "autonomous"): void => {
    if (inFlight[slot]) return;
    const claimed = slot === "interactive"
      ? claimNextQueuedRun(input.connection, taskExecution.cooledProviderIds(), "interactive")
      : claimNextQueuedRun(input.connection, taskExecution.cooledProviderIds(), "any");
    if (!claimed) return;
    inFlight[slot] = true;
    notifyDataChanged();
    void taskExecution.executeRun(claimed.org_id, claimed.id)
      .catch(() => {
        // executeRun records the failure on the run row; the UI reflects it.
      })
      .finally(() => {
        inFlight[slot] = false;
        notifyDataChanged();
      });
  };

  const tick = (): void => {
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
    if (enqueued.length > 0) notifyDataChanged();
    dispatch("interactive");
    dispatch("autonomous");
  };

  const interval = setInterval(tick, intervalMs);
  tick();
  return () => clearInterval(interval);
}
