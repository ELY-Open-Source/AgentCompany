import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { createId } from "../../../shared/ids";

/** How an action run ended: unknown means it was sent and its reply was lost, so it may have taken effect. */
export type ConnectorExecutionOutcome = "succeeded" | "failed" | "unknown";

/** Records an action run before it is sent; an identical call whose outcome is pending or unknown blocks it until the agent confirms it did not happen. */
export function beginConnectorExecution(
  db: DatabaseSync,
  input: { orgId: string; agentId: string; runId: string | null; action: string; args: Record<string, unknown>; confirmedNotDone: boolean },
): { id: string } | { blockedBy: { createdAt: string; detail: string | null } } {
  const hash = createHash("sha256").update(canonicalJson(input.args)).digest("hex");
  const open = db.prepare(`
    select created_at, detail from connector_executions
    where org_id = ? and action = ? and arguments_hash = ? and state in ('pending', 'unknown') order by rowid desc limit 1
  `).get(input.orgId, input.action, hash) as { created_at: string; detail: string | null } | undefined;
  const now = new Date().toISOString();
  if (open && !input.confirmedNotDone) return { blockedBy: { createdAt: open.created_at, detail: open.detail } };
  if (open) {
    db.prepare("update connector_executions set state = 'resolved', updated_at = ? where org_id = ? and action = ? and arguments_hash = ? and state in ('pending', 'unknown')")
      .run(now, input.orgId, input.action, hash);
  }
  const id = createId("cex");
  db.prepare(`
    insert into connector_executions(id, org_id, agent_id, run_id, action, arguments_hash, state, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, input.orgId, input.agentId, input.runId, input.action, hash, now, now);
  return { id };
}

export function settleConnectorExecution(db: DatabaseSync, id: string, outcome: ConnectorExecutionOutcome, detail: string | null): void {
  db.prepare("update connector_executions set state = ?, detail = ?, updated_at = ? where id = ? and state = 'pending'")
    .run(outcome, detail, new Date().toISOString(), id);
}

/** JSON with object keys sorted at every level, so the same arguments always hash the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}
