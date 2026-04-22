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
import { HUMAN_SENDER_ID } from "../messaging/dispatch";
import { logAppError } from "../errors/index.js";
import log from "electron-log/main.js";

export interface InitialUserTurnDeps {
  db: AppDatabase;
}

const MAX_MESSAGE_LINES = 10;
const SUBJECT_PREVIEW_LEN = 80;

export function resolveInitialUserTurn(
  params: {
    trigger: string | null;
    task: ReturnType<AppDatabase["entityCrud"]["getTask"]> | null;
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
    const unread = deps.db.messages.listAgentInboxUnread(companyId, agentId);
    if (unread.length > 0) {
      return buildCommunicationTurn(trigger, unread, deps.db);
    }
  }

  // CEO / team-building semantic cue (C4 part 4/5).
  //
  // The turn names the state and points at the mode contract. The action
  // policy lives in the tool schema and the CEO-mode instructions so model
  // swaps do not depend on an imperative one-off user sentence.
  if (trigger === "timer" || trigger === "bootstrap" || trigger === "app_restart_resume") {
    const cue = tryResolveCeoTeamBuildingCue({ agentId, companyId, db: deps.db });
    if (cue !== null) return cue;
  }

  return buildGenericWakeTurn(trigger);
}

/**
 * Returns the team-building cue when (and only when) the agent is a
 * CEO (`reportsTo == null`) with zero active direct reports. Any other
 * shape returns null and the caller falls through to
 * `buildGenericWakeTurn`. A DB lookup failure is classified and
 * logged — the caller never sees the raw error because the pi agent
 * loop must not crash on a prompt-assembly hiccup, but the classified
 * log line keeps the fail mode visible rather than swallowed.
 */
function tryResolveCeoTeamBuildingCue(params: {
  agentId: string;
  companyId: string;
  db: AppDatabase;
}): string | null {
  const { agentId, companyId, db } = params;
  try {
    const agent = db.entityCrud.getAgent(agentId);
    if (agent.reportsTo) return null;
    const activeReports = db.agents
      .getDirectReports(agentId, companyId)
      .filter((r) => r.status !== "pending_approval" && r.status !== "terminated");
    if (activeReports.length > 0) return null;
    return [
      "This wake: your team is empty.",
      "Follow the Team Building operating instructions using the tools exposed for this run, then return.",
    ].join("\n\n");
  } catch (error) {
    logAppError(
      log,
      error,
      {
        kind: "recoverable",
        code: "initial_user_turn.ceo_lookup.failed",
        message: `CEO team-building cue lookup failed for agent ${agentId}; falling back to the generic timer turn.`,
        context: { agentId, companyId },
      },
      "warn",
    );
    return null;
  }
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
      return "Heartbeat check. Read your briefing and execute the top-priority action described in your Operating Instructions for the mode you are currently in. If your briefing lists unread messages, reply to them before starting task work.";
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
    const name = db.agents.findAgentName(agentId);
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
