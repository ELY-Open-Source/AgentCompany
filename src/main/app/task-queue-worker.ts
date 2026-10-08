import type { BrowserWindow } from "electron";
import type { DatabaseConnection } from "../database/connection";
import { IPC_CHANNELS } from "../../shared/ipc";
import { expireStaleChatWakes } from "../services/chat-agent-wake-service";
import { OrganizationService } from "../services/organization-service";
import { spawnGoalReviews } from "../services/goal-review-service";
import { TaskExecutionService } from "../services/task-execution-service";
import { runningWorkspaceWriter } from "../services/workspace-write-lock";

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

/** Claims the next queued run atomically: human wakes first, then task priority, then age; skips cooling providers, busy agents and busy workspace writers. */
export function claimNextQueuedRun(connection: DatabaseConnection, excludedProviderIds: string[] = [], lane: ClaimLane = "any"): QueuedRun | null {
  return connection.transaction(() => {
    const exclusion = excludedProviderIds.length > 0
      ? `and task_runs.provider_id not in (${excludedProviderIds.map(() => "?").join(", ")})`
      : "";
    const laneFilter = lane === "interactive"
      ? "and json_extract(task_runs.secret_scope_json, '$.sourceSenderType') in ('employee', 'board')"
      : "";
    const candidates = connection.db
      .prepare(`
        select task_runs.id, task_runs.org_id, task_runs.provider_id, task_runs.task_id
        from task_runs join tasks on tasks.id = task_runs.task_id
        where task_runs.state = 'queued' ${exclusion} ${laneFilter}
          and not exists (select 1 from task_runs busy where busy.state = 'running' and busy.agent_id = task_runs.agent_id)
        order by
          case when json_extract(task_runs.secret_scope_json, '$.sourceSenderType') in ('employee', 'board') then 0 else 1 end asc,
          case tasks.priority when 'high' then 0 when 'normal' then 1 else 2 end asc,
          task_runs.created_at asc
      `)
      .all(...excludedProviderIds) as unknown as Array<QueuedRun & { task_id: string }>;
    const candidate = candidates.find((run) => runningWorkspaceWriter(connection.db, run.task_id) === null);
    if (!candidate) return null;
    const row: QueuedRun = { id: candidate.id, org_id: candidate.org_id, provider_id: candidate.provider_id };
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
    // The interactive lane may probe a cooled provider once per park window
    // (a human is asking; a blip should not cost them ten silent minutes);
    // autonomous work always waits the cooldown out.
    const claimed = slot === "interactive"
      ? claimNextQueuedRun(input.connection, taskExecution.interactiveCooledProviderIds(), "interactive")
      : claimNextQueuedRun(input.connection, taskExecution.cooledProviderIds(), "any");
    if (!claimed) return;
    if (slot === "interactive" && claimed.provider_id) taskExecution.noteInteractiveProbe(claimed.provider_id);
    inFlight[slot] = true;
    notifyDataChanged();
    void taskExecution.executeRun(claimed.org_id, claimed.id)
      .catch((error: unknown) => {
        // executeRun already marked the run failed; log so the cause is visible outside the UI.
        console.error(`[task-queue] run ${claimed.id} failed: ${error instanceof Error ? error.message : String(error)}`);
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
