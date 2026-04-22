import type { DesktopResult } from "@shared/contracts";

export interface DesktopErrorEnvelope {
  code: string;
  message: string;
}

export interface AppErrorNotice {
  code: string;
  message: string;
  actionHint: string;
}

export type AppErrorInput =
  | AppErrorNotice
  | DesktopErrorEnvelope
  | Error
  | string
  | null;

const GENERIC_ERROR_CODE = "APP_ERROR";
const ACTION_REQUIRED_CODE = "ACTION_REQUIRED";
const DEFAULT_ACTION_HINT = "Use this code when reporting the issue.";
const SILENT_ERROR_CODES = new Set(["APP_SHUTTING_DOWN"]);

const ACTION_HINTS_BY_CODE: Record<string, string> = {
  ACTION_REQUIRED: "Complete the required selection, then retry the action.",
  AGENT_ALREADY_RUNNING: "Open Runs, review the active run, then retry from the task.",
  AGENT_PENDING_APPROVAL: "Open Approvals, resolve the hire request, then retry the task.",
  AGENT_NOT_RUNNABLE: "Open Agents, activate the assigned agent, then retry the task.",
  APP_SHUTTING_DOWN: "Restart AgentCompany after shutdown completes.",
  BUDGET_POLICY_BLOCKED: "Open Budget, update the blocking policy, then retry the run.",
  CHECKOUT_RACE_LOST: "Refresh tasks, review the current assignee, then try again.",
  COMPANY_NOT_ACTIVE: "Select the active company, then retry the action.",
  COMPANY_NOT_FOUND: "Refresh companies, select an existing company, then retry the action.",
  CONNECTOR_MODEL_NOT_ALLOWED: "Open Connectors, enable an allowed model, then retry the run.",
  CONNECTOR_NOT_FOUND: "Open Connectors, select an available connector, then retry the action.",
  CONNECTOR_NOT_READY: "Open Connectors, complete the credential setup, then retry the run.",
  INVALID_COMPANY_REFERENCE: "Refresh the company data, then retry with a current selection.",
  INVALID_INPUT: "Review the entered fields, then retry the action.",
  INVALID_PAYLOAD: "Review the entered fields, then retry the action.",
  INVALID_TASK_STATE: "Refresh the task, review its current state, then retry the action.",
  MODEL_PICK_FAILED: "Open Connectors, choose an enabled model, then retry the run.",
  OPEN_PATH_FAILED: "Verify the path exists on disk, then open it again.",
  OPEN_PATH_FORBIDDEN: "Open a path inside the managed workspace.",
  RESTORE_BLOCKED: "Stop active runs, then restore the profile backup.",
  RUN_NOT_FOUND: "Refresh Runs, select an existing run, then retry the action.",
  SERVICE_NOT_READY: "Wait for startup to finish, then retry the action.",
  TASK_NOT_FOUND: "Refresh Tasks, select an existing task, then retry the action.",
  TASK_UNASSIGNED: "Assign an agent to the task, then start the run.",
  TASK_VALIDATION_FAILED: "Review the task fields, then save again.",
  WORKER_UNAVAILABLE: "Wait for the worker to become ready, then retry the run.",
  WORKSPACE_COMPANY_MISMATCH: "Select a workspace owned by the current company.",
  WORKSPACE_UNRESOLVED: "Open Workspaces, repair the selected workspace path, then retry the run.",
};

export class DesktopError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "DesktopError";
  }
}

export function createAppErrorNotice(
  message: string,
  code: string = ACTION_REQUIRED_CODE,
  actionHint?: string,
): AppErrorNotice {
  return {
    code: normalizeCode(code),
    message: normalizeMessage(message),
    actionHint: actionHint?.trim() || actionHintForCode(code),
  };
}

export function formatDesktopResultError(error: DesktopErrorEnvelope): AppErrorNotice {
  return createAppErrorNotice(error.message, error.code);
}

export function formatDesktopResultNotice(error: DesktopErrorEnvelope): AppErrorNotice | null {
  if (isSilentDesktopErrorCode(error.code)) {
    return null;
  }
  return formatDesktopResultError(error);
}

export function describeDesktopError(error: unknown): AppErrorNotice {
  if (isAppErrorNotice(error)) {
    return error;
  }

  if (error instanceof DesktopError) {
    return createAppErrorNotice(error.message, error.code);
  }

  if (isDesktopErrorEnvelope(error)) {
    return formatDesktopResultError(error);
  }

  if (error instanceof Error) {
    return createAppErrorNotice(error.message, GENERIC_ERROR_CODE);
  }

  return createAppErrorNotice(String(error), GENERIC_ERROR_CODE);
}

export function normalizeAppErrorNotice(error: AppErrorInput): AppErrorNotice | null {
  if (error === null) {
    return null;
  }
  if (typeof error === "string") {
    return createAppErrorNotice(error);
  }
  return describeDesktopError(error);
}

export function unwrap<T>(result: DesktopResult<T>): T {
  if (!result.ok) {
    throw new DesktopError(result.error.code, result.error.message);
  }
  return result.data;
}

function normalizeCode(code: string): string {
  const trimmed = code.trim();
  return trimmed.length > 0 ? trimmed : GENERIC_ERROR_CODE;
}

function normalizeMessage(message: string): string {
  const trimmed = message.trim();
  return trimmed.length > 0 ? trimmed : "The action could not be completed.";
}

function actionHintForCode(code: string): string {
  const normalized = normalizeCode(code);
  const exactHint = ACTION_HINTS_BY_CODE[normalized.toUpperCase()];
  if (exactHint) {
    return exactHint;
  }

  const lowerCode = normalized.toLowerCase();
  if (lowerCode.includes("connector") || lowerCode.includes("model")) {
    return "Open Connectors, review the provider setup, then retry the action.";
  }
  if (lowerCode.includes("workspace") || lowerCode.includes("path")) {
    return "Open Workspaces, verify the path, then retry the action.";
  }
  if (lowerCode.includes("permission") || lowerCode.includes("forbidden") || lowerCode.includes("unauthorized")) {
    return "Review the account permissions, then retry the action.";
  }
  if (lowerCode.includes("validation") || lowerCode.includes("invalid")) {
    return "Review the entered fields, then retry the action.";
  }
  if (lowerCode.includes("not_found")) {
    return "Refresh the view, select an existing item, then retry the action.";
  }

  return DEFAULT_ACTION_HINT;
}

function isSilentDesktopErrorCode(code: string): boolean {
  return SILENT_ERROR_CODES.has(normalizeCode(code).toUpperCase());
}

function isDesktopErrorEnvelope(error: unknown): error is DesktopErrorEnvelope {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      "message" in error &&
      typeof (error as { code?: unknown }).code === "string" &&
      typeof (error as { message?: unknown }).message === "string",
  );
}

function isAppErrorNotice(error: unknown): error is AppErrorNotice {
  return Boolean(
    isDesktopErrorEnvelope(error) &&
      "actionHint" in error &&
      typeof (error as { actionHint?: unknown }).actionHint === "string",
  );
}
