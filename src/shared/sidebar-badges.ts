import type { ProfileSnapshot } from "./types";

/**
 * Sidebar badge counters, derived purely from `ProfileSnapshot`.
 *
 * This is a local-first desktop app: every row the badges would want
 * to count is already in memory via `ProfileSnapshot` (which is scoped
 * to the current company and refreshed as an atomic unit). Running a
 * second server-side aggregation — as the old `getSidebarBadges` IPC
 * did — created two parallel data paths for the same answer, and the
 * two drifted whenever one side's data was mutated between refreshes
 * (e.g. a message being marked read in Communication). The resulting
 * "badge = 1, inbox = empty" mismatch was the visible symptom.
 *
 * Derivation eliminates the class. Same snapshot in, same badge out.
 * No IPC, no state, no drift.
 */
export interface SidebarBadges {
  pendingApprovals: number;
  activeRuns: number;
  failedRuns: number;
  todoTasks: number;
  budgetWarnings: number;
  unreadMessages: number;
}

const FAILED_RUN_STATUSES: ReadonlyArray<string> = ["failed", "timed_out", "interrupted"];
const ACTIVE_RUN_STATUSES: ReadonlyArray<string> = ["queued", "running"];
const OPEN_TASK_STATUSES: ReadonlyArray<string> = ["todo", "in_progress", "in_review"];
const BUDGET_WARNING_RATIO = 0.8;

/**
 * Derive the sidebar badge counts for the current snapshot. Call this
 * from the renderer whenever the snapshot changes; it is cheap
 * (O(n) linear filters over arrays that never exceed the snapshot's
 * per-company caps).
 *
 * `snapshot.agentMessages[i].readAt` already reflects the board
 * reader's read timestamp (the snapshot query joins
 * `agent_message_reads` with `agent_id = BOARD_READER_ID` and projects
 * that value into the `readAt` field — see
 * `src/main/database/snapshot.ts`). So the unread filter here is just
 * "no board read receipt" plus the same channel/priority scope the
 * old server query used.
 */
export function deriveSidebarBadges(snapshot: ProfileSnapshot, companyId: string | null): SidebarBadges {
  // The snapshot query is already company-scoped when `currentCompanyId`
  // is non-null (see `listRendererSnapshot` → `listSnapshot`). The extra
  // `companyId` filter here is defensive: on the rare path where the
  // caller passes an un-scoped snapshot (e.g., cross-company testing),
  // we still count the right company's rows rather than the union.
  const matchesCompany = <T extends { companyId: string }>(row: T): boolean =>
    companyId === null || row.companyId === companyId;

  let pendingApprovals = 0;
  for (const approval of snapshot.approvals) {
    if (matchesCompany(approval) && approval.state === "pending") pendingApprovals += 1;
  }

  let activeRuns = 0;
  let failedRuns = 0;
  for (const run of snapshot.runs) {
    if (!matchesCompany(run)) continue;
    if (ACTIVE_RUN_STATUSES.includes(run.status)) activeRuns += 1;
    else if (FAILED_RUN_STATUSES.includes(run.status)) failedRuns += 1;
  }

  let todoTasks = 0;
  for (const task of snapshot.tasks) {
    if (matchesCompany(task) && OPEN_TASK_STATUSES.includes(task.status)) todoTasks += 1;
  }

  let budgetWarnings = 0;
  for (const agent of snapshot.agents) {
    if (!matchesCompany(agent)) continue;
    if (agent.budgetMonthlyUsd > 0 && agent.spentMonthlyUsd / agent.budgetMonthlyUsd >= BUDGET_WARNING_RATIO) {
      budgetWarnings += 1;
    }
  }

  let unreadMessages = 0;
  for (const message of snapshot.agentMessages) {
    if (!matchesCompany(message)) continue;
    if (message.readAt) continue;
    if (
      message.channel === "company" ||
      message.channel === "incident" ||
      message.priority === "urgent"
    ) {
      unreadMessages += 1;
    }
  }

  return {
    pendingApprovals,
    activeRuns,
    failedRuns,
    todoTasks,
    budgetWarnings,
    unreadMessages,
  };
}
