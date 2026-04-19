import type { InboxItem, ProfileSnapshot } from "./types";

/**
 * Inbox items, derived purely from `ProfileSnapshot`.
 *
 * Mirrors the single-source-of-truth pattern used for sidebar badges
 * (`sidebar-badges.ts`). The renderer already holds every row the
 * inbox would aggregate — approvals, runs, tasks, agents, messages —
 * so the old `getInbox` IPC was a second aggregation path that could
 * drift. Deriving on the client from the snapshot removes the drift
 * class and the round-trip.
 *
 * Parity note: the five item categories (`pending_approval`,
 * `failed_run`, `budget_warning`, `blocked_task` / `review_needed`,
 * `agent_message`) match what the old `buildDocumentMethods::getInbox`
 * produced. One behavioural drop: the old SQL limited failed-run
 * items to the last 24 hours; we preserve that window here using the
 * snapshot's `createdAt` strings and the caller's "now".
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const BUDGET_WARNING_RATIO = 0.8;
const URGENT_CHANNELS: ReadonlyArray<string> = ["company", "incident"];

const SEVERITY_ORDER: Record<InboxItem["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** Build the inbox list from the current snapshot for the given company. */
export function deriveInboxItems(
  snapshot: ProfileSnapshot,
  companyId: string | null,
  now: Date = new Date(),
): InboxItem[] {
  if (!companyId) return [];
  const agentNameMap = new Map<string, string>();
  for (const agent of snapshot.agents) {
    if (agent.companyId === companyId) agentNameMap.set(agent.id, agent.name);
  }

  const items: InboxItem[] = [];
  const oneDayAgoIso = new Date(now.getTime() - ONE_DAY_MS).toISOString();

  for (const approval of snapshot.approvals) {
    if (approval.companyId !== companyId) continue;
    if (approval.state !== "pending") continue;
    const requesterName = approval.requestedByAgentId
      ? agentNameMap.get(approval.requestedByAgentId) ?? null
      : null;
    items.push({
      id: `approval-${approval.id}`,
      type: "pending_approval",
      title: approval.payloadSummary,
      subtitle: `${approval.type.replaceAll("_", " ")} — requested by ${requesterName ?? "Unknown"}`,
      severity: approval.type === "dangerous_command" ? "critical" : "high",
      entityType: "approval",
      entityId: approval.id,
      agentId: approval.requestedByAgentId,
      agentName: requesterName,
      createdAt: approval.createdAt,
    });
  }

  for (const run of snapshot.runs) {
    if (run.companyId !== companyId) continue;
    if (run.status !== "failed" && run.status !== "timed_out") continue;
    if (run.createdAt <= oneDayAgoIso) continue;
    const agentName = agentNameMap.get(run.agentId) ?? null;
    items.push({
      id: `run-${run.id}`,
      type: "failed_run",
      title: run.summary || "Run failed",
      subtitle: `${agentName ?? "Unknown agent"} — ${run.errorMessage?.slice(0, 100) ?? "Unknown error"}`,
      severity: "high",
      entityType: "run",
      entityId: run.id,
      agentId: run.agentId,
      agentName,
      createdAt: run.createdAt,
    });
  }

  for (const agent of snapshot.agents) {
    if (agent.companyId !== companyId) continue;
    if (agent.budgetMonthlyUsd <= 0) continue;
    const ratio = agent.spentMonthlyUsd / agent.budgetMonthlyUsd;
    if (ratio <= BUDGET_WARNING_RATIO) continue;
    const pct = Math.round(ratio * 100);
    items.push({
      id: `budget-${agent.id}`,
      type: "budget_warning",
      title: `${agent.name} at ${pct}% budget`,
      subtitle: `$${agent.spentMonthlyUsd.toFixed(2)} of $${agent.budgetMonthlyUsd.toFixed(2)} monthly limit`,
      severity: pct >= 100 ? "critical" : "high",
      entityType: "agent",
      entityId: agent.id,
      agentId: agent.id,
      agentName: agent.name,
      createdAt: agent.updatedAt,
    });
  }

  for (const task of snapshot.tasks) {
    if (task.companyId !== companyId) continue;
    if (task.status !== "blocked" && task.status !== "in_review") continue;
    const assigneeName = task.assigneeAgentId ? agentNameMap.get(task.assigneeAgentId) ?? null : null;
    if (task.status === "blocked") {
      items.push({
        id: `blocked-${task.id}`,
        type: "blocked_task",
        title: task.title,
        subtitle: `Assigned to ${assigneeName ?? "Unassigned"} — blocked`,
        severity: task.priority === "critical" ? "critical" : "medium",
        entityType: "task",
        entityId: task.id,
        agentId: task.assigneeAgentId,
        agentName: assigneeName,
        createdAt: task.updatedAt,
      });
    } else {
      items.push({
        id: `review-${task.id}`,
        type: "review_needed",
        title: task.title,
        subtitle: `Submitted by ${assigneeName ?? "Unknown"} — awaiting review`,
        severity: task.priority === "critical" ? "high" : "medium",
        entityType: "task",
        entityId: task.id,
        agentId: task.assigneeAgentId,
        agentName: assigneeName,
        createdAt: task.updatedAt,
      });
    }
  }

  for (const message of snapshot.agentMessages) {
    if (message.companyId !== companyId) continue;
    if (message.readAt) continue;
    const visible =
      URGENT_CHANNELS.includes(message.channel) || message.priority === "urgent";
    if (!visible) continue;
    const senderName = agentNameMap.get(message.fromAgentId) ?? null;
    const urgencyTag = message.priority === "urgent" ? " (urgent)" : "";
    items.push({
      id: `message-${message.id}`,
      type: "agent_message",
      title: message.subject,
      subtitle: `${senderName ?? "Unknown"} — ${message.channel === "incident" ? "INCIDENT" : message.channel}${urgencyTag}`,
      severity: message.priority === "urgent" || message.channel === "incident" ? "critical" : "medium",
      entityType: "message",
      entityId: message.id,
      agentId: message.fromAgentId,
      agentName: senderName,
      createdAt: message.createdAt,
    });
  }

  items.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  return items;
}
