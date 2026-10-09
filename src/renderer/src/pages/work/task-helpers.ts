import {
  TASK_STATUS,
  WRITING_MODE,
  type AgentRecord,
  type ProviderRecord,
  type TaskRecord,
  type TaskRunRecord,
  type TaskStatus,
  type WorkLanguage,
  type WritingMode,
} from "../../../../shared/domain";
import { t } from "../../i18n/i18n";

/** Each working language in its own script, so it reads right whatever the display language. */
export const WORK_LANGUAGE_NAMES: Record<WorkLanguage, string> = { en: "English", zh: "简体中文" };

/** The task form's working language: blank follows the company. */
export function readWorkLanguage(form: FormData): WorkLanguage | null {
  const value = String(form.get("workLanguage") ?? "");
  if (value === "") return null;
  if (value === "en" || value === "zh") return value;
  throw new Error(`Unknown working language "${value}".`);
}

/** The writing modes a task can ask for, as the create and edit forms offer them. */
export const WRITING_OPTIONS: ReadonlyArray<{ value: WritingMode; label: string }> = [
  { value: WRITING_MODE.CONVERSATIONAL, label: t("Conversational (house style)") },
  { value: WRITING_MODE.TECHNICAL, label: t("Technical spec") },
  { value: WRITING_MODE.STRUCTURED, label: t("Structured output") },
];


/** Real work: not the vehicle of a chat reply or a goal checkpoint, which the system creates for itself. */
export function isBusinessTask(task: TaskRecord): boolean {
  return task.origin !== "chat_wake" && task.origin !== "goal_review";
}

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
  if (state === "stopped") return t("stopped");
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

/** Every task beneath this one; none of them may become its parent. */
export function descendantIds(taskId: string, tasks: TaskRecord[]): Set<string> {
  const found = new Set<string>();
  const frontier = [taskId];
  while (frontier.length > 0) {
    const current = frontier.pop();
    for (const task of tasks) {
      if (task.parentTaskId === current && !found.has(task.id)) {
        found.add(task.id);
        frontier.push(task.id);
      }
    }
  }
  return found;
}
