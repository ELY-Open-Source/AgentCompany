import type { DatabaseSync } from "node:sqlite";
import type { TaskHold } from "../../shared/domain";
import { currentProviderUsageWindow } from "../../shared/provider-runtime-domain";
import { budgetBlock, isPriced, providerPrices } from "./spend";

interface OpenTaskRow {
  id: string;
  status: string;
  stalled_reason: string | null;
  blocked_reason: string | null;
  enqueue_error: string | null;
  agent_id: string | null;
  provider_id: string | null;
  provider_label: string | null;
  request_limit: number;
  request_count: number;
  cooldown_until_ms: number | null;
  cooldown_label: string | null;
}

/** Why each open task without a run in flight is not moving, when it resumes on its own, and who must act otherwise. */
export function taskHolds(db: DatabaseSync, now: Date): Map<string, TaskHold> {
  const window = currentProviderUsageWindow(now);
  const rows = db.prepare(`
    select t.id, t.status, t.stalled_reason, t.blocked_reason, t.enqueue_error, a.id as agent_id, p.id as provider_id, p.label as provider_label,
      p.monthly_request_limit as request_limit, coalesce(u.request_count, 0) as request_count,
      c.until_ms as cooldown_until_ms, c.label as cooldown_label
    from tasks t
    left join agents a on a.id = t.assignee_agent_id
    left join providers p on p.id = a.model_provider_id
    left join provider_usage_windows u on u.org_id = p.org_id and u.provider_id = p.id and u.window_start = ?
    left join provider_cooldowns c on c.provider_id = p.id
    where (t.status in ('backlog', 'in_progress') or (t.status = 'review' and t.blocked_reason is not null))
      and not exists (select 1 from task_runs r where r.task_id = t.id and r.state = 'running')
  `).all(window.start) as unknown as OpenTaskRow[];
  const budgets = new Map<string, MoneyBlock | null>();
  // A zero cap stays spent after the monthly reset, so only raising it lets the work resume.
  const zeroCap = db.prepare(`
    select a.budget_cents = 0 or coalesce(d.monthly_budget_limit_cents, 1) = 0 as zero
    from agents a left join org_departments d on d.org_id = a.org_id and d.name = a.department where a.id = ?
  `);
  const holds = new Map<string, TaskHold>();
  for (const row of rows) {
    const hold = holdOf(row, now, window.end, (agentId, providerId) => {
      let block = budgets.get(agentId);
      if (block === undefined) {
        const reason = budgetBlock(db, agentId, isPriced(providerPrices(db, providerId)), now);
        block = reason ? { reason, renews: (zeroCap.get(agentId) as { zero: number }).zero === 0 } : null;
        budgets.set(agentId, block);
      }
      return block;
    });
    if (hold) holds.set(row.id, hold);
  }
  return holds;
}

interface MoneyBlock {
  reason: string;
  /** False when a zero cap means the next month starts spent too. */
  renews: boolean;
}

function holdOf(row: OpenTaskRow, now: Date, windowEnd: string, budget: (agentId: string, providerId: string) => MoneyBlock | null): TaskHold | null {
  if (row.blocked_reason) return { reason: `Blocked: ${row.blocked_reason}`, resumesAt: null, waitingOn: "operator" };
  // Work in review waits on its reviewer, so only a block holds it here.
  if (row.status === "review") return null;
  if (row.stalled_reason) return { reason: row.stalled_reason, resumesAt: null, waitingOn: "operator" };
  if (row.enqueue_error) return { reason: `Could not start: ${row.enqueue_error}`, resumesAt: null, waitingOn: "operator" };
  if (!row.agent_id || !row.provider_id) return null;
  if (row.request_count >= row.request_limit) {
    if (row.request_limit === 0) return { reason: `${row.provider_label} has a monthly request limit of 0. Raise the limit to let its work run.`, resumesAt: null, waitingOn: "operator" };
    return { reason: `${row.provider_label} used its monthly request limit (${row.request_limit}). Raise the limit or wait for the next window.`, resumesAt: windowEnd, waitingOn: "operator" };
  }
  const spent = budget(row.agent_id, row.provider_id);
  if (spent) return { reason: spent.reason, resumesAt: spent.renews ? windowEnd : null, waitingOn: "operator" };
  if (row.cooldown_until_ms !== null && row.cooldown_until_ms > now.getTime()) {
    return { reason: `${row.cooldown_label} reported a passing failure; its work waits out a cooldown.`, resumesAt: new Date(row.cooldown_until_ms).toISOString(), waitingOn: "provider" };
  }
  return null;
}
