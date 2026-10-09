import type { ApprovalRecord, TaskPriority, TaskRecord } from "../../../../shared/domain";

/** One thing to look at next, in the single order Home shows them: decisions waiting on you, then work stopped until you act, then the next task in line. */
export type NextUpItem =
  | { kind: "approval"; approval: ApprovalRecord }
  | { kind: "held"; task: TaskRecord; reason: string }
  | { kind: "next"; task: TaskRecord };

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

const byPriorityThenOldest = (a: TaskRecord, b: TaskRecord) =>
  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt.localeCompare(b.createdAt);

export function nextUp(approvals: ApprovalRecord[], tasks: TaskRecord[]): { needsYou: NextUpItem[]; next: NextUpItem | null } {
  const waiting: NextUpItem[] = approvals
    .filter((approval) => approval.state === "pending")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((approval) => ({ kind: "approval", approval }));
  const open = tasks.filter((task) => task.status !== "done");
  const held: NextUpItem[] = open
    .filter((task) => task.hold?.waitingOn === "operator")
    .sort(byPriorityThenOldest)
    .map((task) => ({ kind: "held", task, reason: task.hold!.reason }));
  // Work already under way comes before work not yet started.
  const inLine = open
    .filter((task) => task.hold === null && task.status !== "review")
    .sort((a, b) => Number(a.status !== "in_progress") - Number(b.status !== "in_progress") || byPriorityThenOldest(a, b))[0];
  return { needsYou: [...waiting, ...held], next: inLine ? { kind: "next", task: inLine } : null };
}
