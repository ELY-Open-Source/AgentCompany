import type { DatabaseSync } from "node:sqlite";
import type { ChatReplyStatus } from "../../shared/chat-domain";
import type { TaskHold } from "../../shared/domain";

const EXPIRED_PREFIX = "Expired:";

/** Where each agent reply a loaded message asked for stands: its wake task, through every run (checkpoints and continuations too). */
export function chatReplyStatuses(db: DatabaseSync, messageIds: string[], holds: Map<string, TaskHold>): ChatReplyStatus[] {
  const requests = db.prepare(`
    select q.message_id, q.agent_id, q.task_id, t.status as task_status, r.state as run_state, r.error_message
    from chat_reply_requests q
    join tasks t on t.id = q.task_id
    left join task_runs r on r.id = (select id from task_runs where task_id = q.task_id order by created_at desc, rowid desc limit 1)
    where q.message_id in (select value from json_each(?))
    order by q.created_at, q.rowid
  `).all(JSON.stringify(messageIds)) as Array<{
    message_id: string; agent_id: string; task_id: string; task_status: string; run_state: string | null; error_message: string | null;
  }>;
  return requests.map((request): ChatReplyStatus => {
    const base = { messageId: request.message_id, agentId: request.agent_id };
    if (request.run_state === "running") return { ...base, state: "running", detail: null, resumesAt: null };
    if (request.run_state === "failed") {
      if (request.error_message === null) throw new Error(`The reply to message ${request.message_id} failed without a recorded reason.`);
      return { ...base, state: request.error_message.startsWith(EXPIRED_PREFIX) ? "expired" : "failed", detail: request.error_message, resumesAt: null };
    }
    if (request.run_state === "stopped" || request.run_state === "superseded") return { ...base, state: "stopped", detail: request.error_message, resumesAt: null };
    // A completed run replied only if it closed the wake task; a step-limit checkpoint leaves it open for the next session.
    if (request.task_status === "done") return { ...base, state: "replied", detail: null, resumesAt: null };
    const hold = holds.get(request.task_id);
    return hold ? { ...base, state: "waiting", detail: hold.reason, resumesAt: hold.resumesAt } : { ...base, state: "queued", detail: null, resumesAt: null };
  });
}
