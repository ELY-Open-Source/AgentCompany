/**
 * Resolve the initial user-role turn that seeds an agent's pi run.
 *
 * The previous layout defaulted to the literal string `"Continue."` when
 * no task was attached, so every message-wake or peer-request run started
 * the agent with a prompt that carried no signal at all — combined with
 * the system-prompt heartbeat fallback that invited status summaries,
 * the recipient would routinely "reply" by narrating its own queue
 * instead of answering the message that woke it.
 *
 * This module replaces that default with a trigger-specific imperative,
 * and — for communication wakes — binds the initial turn to the actual
 * inbox rows so the agent sees concrete `message_id` / sender references
 * in its first user turn. The full message bodies still arrive as
 * priorMessages through `prepareRun`'s inbox projection; this turn is
 * the action cue on top of them.
 */

import type { AppDatabase } from "../database";
import type { AgentMessageRecord } from "@shared/types";
import { HUMAN_SENDER_ID } from "../message-dispatch";

export interface InitialUserTurnDeps {
  db: AppDatabase;
}

const MAX_MESSAGE_LINES = 10;
const SUBJECT_PREVIEW_LEN = 80;

export function resolveInitialUserTurn(
  params: {
    trigger: string | null;
    task: ReturnType<AppDatabase["getTask"]> | null;
    companyId: string;
    agentId: string;
  },
  deps: InitialUserTurnDeps,
): string {
  const { trigger, task, companyId, agentId } = params;

  if (task) {
    const description = (task.description ?? "").trim();
    return description.length > 0 ? `${task.title}\n\n${description}` : task.title;
  }

  if (trigger === "message" || trigger === "peer_request") {
    const unread = deps.db.listAgentInboxUnread(companyId, agentId);
    if (unread.length > 0) {
      return buildCommunicationTurn(trigger, unread, deps.db);
    }
  }

  return buildGenericWakeTurn(trigger);
}

function buildCommunicationTurn(
  trigger: "message" | "peer_request",
  unread: AgentMessageRecord[],
  db: AppDatabase,
): string {
  const rows = unread.slice(0, MAX_MESSAGE_LINES).map((record) => {
    const senderLabel = record.fromAgentId === HUMAN_SENDER_ID
      ? "Board/Human"
      : resolveAgentLabel(db, record.fromAgentId);
    const subject = truncate(record.subject || "(no subject)", SUBJECT_PREVIEW_LEN);
    const parentRef = record.parentMessageId ? ` · reply_to=${record.parentMessageId}` : "";
    return `- message_id=${record.id} · from=${senderLabel} (${record.fromAgentId}) · channel=${record.channel}${parentRef} · "${subject}"`;
  });
  const overflow = unread.length > MAX_MESSAGE_LINES
    ? `\n…and ${unread.length - MAX_MESSAGE_LINES} more in your inbox.`
    : "";
  const header = trigger === "peer_request"
    ? "A peer has requested your attention. Respond to each of the following messages:"
    : "You have new messages. Respond to each of the following:";
  return `${header}\n${rows.join("\n")}${overflow}\n\nFor every row, reply to the sender using its message_id (channel-appropriate) and mark the message as read before moving on.`;
}

function buildGenericWakeTurn(trigger: string | null): string {
  switch (trigger) {
    case "timer":
      return "Heartbeat check. Review your briefing, then take the highest-priority action: deliverable reviews first, unblocking reports second, next step on assigned work third.";
    case "assignment":
      return "A new task has been assigned to you. Find it in your briefing, check it out via POST /api/issues/{issueId}/checkout, then begin work.";
    case "comment":
      return "A new comment landed on one of your tasks. Read the recent comments in your briefing and respond or adjust your work as needed.";
    case "approval_resolved":
      return "An approval you requested has been decided. Act on the outcome surfaced in your briefing.";
    case "subtask_completed":
      return "A subtask you delegated is ready for review. Evaluate the work against its acceptance criteria and either accept it or request changes.";
    case "task_review_requested":
      return "A direct report submitted a top-level task for your review. Validate against the original acceptance criteria before deciding.";
    case "goal_activated":
      return "A goal you own has been activated. Decompose it into projects and tasks, then delegate the first batch of work.";
    case "report_blocked":
      return "One of your reports is blocked. Investigate the blocker, provide direction or credentials, and unblock them.";
    case "report_failed":
      return "A run by one of your reports has failed. Diagnose, decide on retry or reassignment, then act.";
    case "report_stuck":
      return "One of your reports has exhausted its self-wake budget without progress. Check its state and take corrective action.";
    case "task_continuation":
      return "Continue on your most actionable assigned task.";
    case "bootstrap":
      return "This is an early heartbeat for your company. Translate active goals into concrete projects, tasks, and hiring plans.";
    case "manual":
      return "You were woken manually by the human operator. Review your briefing and act on whatever they are waiting on.";
    case "message":
    case "peer_request":
      return "A communication arrived but your inbox is empty now — another run may have delivered it. Review your recent transcript and continue any in-progress collaboration.";
    default:
      return "Review your briefing and take the next appropriate action.";
  }
}

function resolveAgentLabel(db: AppDatabase, agentId: string): string {
  try {
    const name = db.findAgentName(agentId);
    if (name && name.length > 0) return name;
  } catch {
    // fall through
  }
  return agentId;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
