import type { TaskHold } from "../../../../shared/domain";
import { t } from "../../i18n/i18n";

/** What an agent in the office is doing, from real records: a running session, work held for the operator or a provider cooldown, a queued session, or nothing. */
export type OfficeState = "running" | "blocked" | "cooldown" | "queued" | "idle";

export interface OfficeStatus {
  state: OfficeState;
  /** What holds a blocked or cooling-down agent. */
  hold: TaskHold | null;
}

interface Inputs {
  runs: Array<{ agentId: string | null; state: string }>;
  tasks: Array<{ id: string; assigneeAgentId: string | null; status: string; hold: TaskHold | null }>;
  approvals: Array<{ sourceEntityType: string | null; sourceEntityId: string | null; state: string }>;
}

/** The one state an agent shows: running beats blocked, which beats a cooldown, which beats a queued session. */
export function officeStatus(agentId: string, inputs: Inputs): OfficeStatus {
  const runs = inputs.runs.filter((run) => run.agentId === agentId);
  if (runs.some((run) => run.state === "running")) return { state: "running", hold: null };
  const open = inputs.tasks.filter((task) => task.assigneeAgentId === agentId && task.status !== "done");
  const holds = open.filter((task) => task.hold !== null).map((task) => task.hold!);
  const operator = holds.find((hold) => hold.waitingOn === "operator");
  if (operator) return { state: "blocked", hold: operator };
  const awaitingApproval = inputs.approvals.some((approval) => approval.state === "pending" && approval.sourceEntityType === "task" && open.some((task) => task.id === approval.sourceEntityId));
  if (awaitingApproval) return { state: "blocked", hold: { reason: t("Waiting for your approval."), waitingOn: "operator", resumesAt: null } };
  const provider = holds.find((hold) => hold.waitingOn === "provider");
  if (provider) return { state: "cooldown", hold: provider };
  if (runs.some((run) => run.state === "queued")) return { state: "queued", hold: null };
  return { state: "idle", hold: null };
}
