import {
  TASK_STATUS,
  type AgentRecord,
  type ProviderRecord,
  type TaskRunRecord,
  type TaskStatus,
} from "../../../../shared/domain";

export function nextStatus(status: TaskStatus): TaskStatus | null {
  if (status === TASK_STATUS.BACKLOG) return TASK_STATUS.IN_PROGRESS;
  if (status === TASK_STATUS.IN_PROGRESS) return TASK_STATUS.REVIEW;
  if (status === TASK_STATUS.REVIEW) return TASK_STATUS.DONE;
  return null;
}

export function prettyStatus(status: TaskStatus): string {
  return status.replaceAll("_", " ");
}

export function prettyRunState(state: string): string {
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

export function canRun(provider: ProviderRecord | null): boolean {
  return provider?.enabled === true && provider.authState === "configured";
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
