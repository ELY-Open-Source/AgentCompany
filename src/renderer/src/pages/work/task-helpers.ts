import {
  TASK_STATUS,
  type AgentRecord,
  type ProviderRecord,
  type TaskRecord,
  type TaskRunRecord,
  type TaskStatus,
} from "../../../../shared/domain";
import { t } from "../../i18n/i18n";

export function nextStatus(status: TaskStatus): TaskStatus | null {
  if (status === TASK_STATUS.BACKLOG) return TASK_STATUS.IN_PROGRESS;
  if (status === TASK_STATUS.IN_PROGRESS) return TASK_STATUS.REVIEW;
  if (status === TASK_STATUS.REVIEW) return TASK_STATUS.DONE;
  return null;
}

export function prettyStatus(status: TaskStatus): string {
  if (status === TASK_STATUS.BACKLOG) return t("backlog");
  if (status === TASK_STATUS.IN_PROGRESS) return t("in progress");
  if (status === TASK_STATUS.REVIEW) return t("review");
  return t("done");
}

export function prettyRunState(state: string): string {
  if (state === "queued") return t("queued");
  if (state === "running") return t("running");
  if (state === "completed") return t("completed");
  if (state === "failed") return t("failed");
  if (state === "superseded") return t("superseded");
  return state.replaceAll("_", " ");
}

export function runTone(state: string): "amber" | "green" | "red" | undefined {
  if (state === "running" || state === "queued") return "amber";
  if (state === "completed") return "green";
  if (state === "failed") return "red";
  return undefined;
}

export function providerFor(assignee: AgentRecord | null, providers: ProviderRecord[]): ProviderRecord | null {
  if (!assignee?.modelProviderId) return null;
  return providers.find((provider) => provider.id === assignee.modelProviderId) ?? null;
}

/** Why a manual run is not possible right now, or null when it is. */
export function runBlocker(task: TaskRecord, provider: ProviderRecord | null, taskRuns: TaskRunRecord[]): string | null {
  if (provider?.enabled !== true || provider.authState !== "configured") return t("Connect a provider to run");
  if (task.status === "done") return t("Done tasks do not run");
  if (taskRuns.some((run) => run.taskId === task.id && (run.state === "queued" || run.state === "running"))) return t("A session is already queued or running");
  return null;
}

export function latestTaskRun(taskId: string, taskRuns: TaskRunRecord[]): TaskRunRecord | null {
  for (let index = taskRuns.length - 1; index >= 0; index -= 1) {
    const run = taskRuns[index];
    if (run?.taskId === taskId) return run;
  }
  return null;
}

export function runsForTask(taskId: string, taskRuns: TaskRunRecord[]): TaskRunRecord[] {
  return taskRuns.filter((run) => run.taskId === taskId);
}
