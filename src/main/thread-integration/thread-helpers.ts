/** Thread Integration — shared helpers and types. */

import type { AppDatabase } from "../database";
import type { ThreadType } from "@shared/types";

export interface ThreadIntegrationDeps {
  db: AppDatabase;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  emitEvent?: (event: import("@shared/types").DesktopEvent) => void;
  publishDomainChanged?: () => void;
  notify?: (options: { title: string; body: string }) => void;
}

export function findTaskThread(db: AppDatabase, taskId: string, companyId: string) {
  const existing = db.listThreads({
    companyId,
    type: "task" as ThreadType,
    relatedEntityType: "task",
    relatedEntityId: taskId,
    limit: 1,
  });
  return existing[0] ?? null;
}

export function ensureTaskThread(db: AppDatabase, taskId: string, companyId: string, title: string) {
  const existing = findTaskThread(db, taskId, companyId);
  if (existing) return existing;

  return db.createThread({
    companyId,
    title,
    type: "task" as ThreadType,
    relatedEntityType: "task",
    relatedEntityId: taskId,
  });
}

export function findAgentCommunicationThread(db: AppDatabase, agentId: string, companyId: string) {
  const existing = db.listThreads({
    companyId,
    type: "general" as ThreadType,
    relatedEntityType: "agent",
    relatedEntityId: agentId,
    limit: 1,
  });
  return existing[0] ?? null;
}

/**
 * Returns (or creates) the single "general" thread that accumulates an
 * agent's taskless communication activity. Task runs already write into
 * a task-scoped thread; taskless communication runs would otherwise drop
 * their conversation events on the floor, leaving the thread view blank
 * even while the agent actively replies to peers.
 */
export function ensureAgentCommunicationThread(
  db: AppDatabase,
  agentId: string,
  companyId: string,
  agentLabel: string,
) {
  const existing = findAgentCommunicationThread(db, agentId, companyId);
  if (existing) return existing;

  return db.createThread({
    companyId,
    title: `${agentLabel} · communication`,
    type: "general" as ThreadType,
    relatedEntityType: "agent",
    relatedEntityId: agentId,
  });
}

export function findApprovalThread(db: AppDatabase, approvalId: string, companyId: string) {
  const existing = db.listThreads({
    companyId,
    type: "approval" as ThreadType,
    relatedEntityType: "approval",
    relatedEntityId: approvalId,
    limit: 1,
  });
  return existing[0] ?? null;
}

export function ensureApprovalThread(db: AppDatabase, approvalId: string, companyId: string, title: string) {
  const existing = findApprovalThread(db, approvalId, companyId);
  if (existing) return existing;

  return db.createThread({
    companyId,
    title,
    type: "approval" as ThreadType,
    relatedEntityType: "approval",
    relatedEntityId: approvalId,
  });
}

function resolveApprovalAnnouncementChannel(
  db: AppDatabase,
  companyId: string,
  taskId: string | null,
  requestedByAgentId: string | null,
  logger: ThreadIntegrationDeps["logger"],
): { channel: "department" | "project" | "company"; channelTargetId: string | null } | null {
  if (requestedByAgentId) {
    try {
      const requester = db.getAgent(requestedByAgentId);
      if (requester.companyId === companyId && requester.department) {
        return { channel: "department", channelTargetId: requester.department };
      }
    } catch (err) {
      logger.warn(`[thread-helpers] getAgent failed for requester ${requestedByAgentId}; falling through to task targeting:`, err instanceof Error ? err.message : String(err));
    }
  }

  if (taskId) {
    try {
      const task = db.getTask(taskId);
      if (task.companyId === companyId && task.projectId) {
        return { channel: "project", channelTargetId: task.projectId };
      }
    } catch (err) {
      logger.warn(`[thread-helpers] getTask failed for task ${taskId}; falling through to company routing:`, err instanceof Error ? err.message : String(err));
    }
  }

  return { channel: "company", channelTargetId: null };
}

export function announceApprovalToBoard(
  db: AppDatabase,
  approval: {
    id: string;
    companyId: string;
    relatedTaskId: string | null;
    requestedByAgentId: string | null;
    payloadSummary: string;
    impactSummary: string;
  },
  deps: Pick<ThreadIntegrationDeps, "emitEvent" | "publishDomainChanged" | "logger">,
): void {
  if (!approval.requestedByAgentId || !deps.emitEvent || !deps.publishDomainChanged) return;

  const target = resolveApprovalAnnouncementChannel(
    db,
    approval.companyId,
    approval.relatedTaskId,
    approval.requestedByAgentId,
    deps.logger,
  );
  if (!target) return;

  const messageId = db.sendAgentMessage({
    companyId: approval.companyId,
    fromAgentId: approval.requestedByAgentId,
    channel: target.channel,
    channelTargetId: target.channelTargetId,
    subject: approval.payloadSummary,
    body: `@Board ${approval.impactSummary || approval.payloadSummary}`,
    priority: "urgent",
    senderKind: "agent",
  });
  const message = db.getAgentMessage(messageId, approval.companyId);
  if (message) {
    deps.emitEvent({ type: "new-message", message });
  }
  deps.publishDomainChanged();
}

/** Check subscriber notifyOn preferences and fire desktop notification. */
export function notifyThreadSubscribers(
  db: AppDatabase,
  threadId: string,
  threadTitle: string,
  eventBody: string,
  notify?: (options: { title: string; body: string }) => void,
): void {
  if (!notify) return;
  const subscriptions = db.listSubscriptions(threadId);
  for (const sub of subscriptions) {
    if (sub.subscriberType !== "user") continue;
    if (sub.notifyOn === "none") continue;
    if (sub.notifyOn === "mentions") {
      if (!eventBody.includes("@You") && !eventBody.includes("@user") && !eventBody.includes("@Board")) continue;
    }
    notify({ title: threadTitle, body: eventBody });
    break;
  }
}
