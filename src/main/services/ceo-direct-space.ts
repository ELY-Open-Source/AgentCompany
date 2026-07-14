import type { DatabaseSync } from "node:sqlite";
import { ChatService } from "./chat-service";

/**
 * The founder's direct line to the CEO: every organization keeps one direct
 * conversation between its primary employee (the human operator) and its CEO
 * (the c_suite agent — the same predicate the grant system enforces). The
 * Messages page pins this conversation at the top, so it exists as a
 * structural invariant instead of appearing lazily on first use.
 *
 * Returns the space id, or null while the org has no employee or no active
 * CEO yet (mid-bootstrap) — the next ensure pass picks it up.
 */
export function ensureCeoDirectSpace(db: DatabaseSync, orgId: string): string | null {
  const employee = db.prepare("select id from employees where org_id = ? order by created_at asc limit 1")
    .get(orgId) as { id: string } | undefined;
  const ceo = db.prepare(`
    select id from agents
    where org_id = ? and role_level = 'c_suite' and lifecycle = 'active'
    order by created_at asc
    limit 1
  `).get(orgId) as { id: string } | undefined;
  if (!employee || !ceo) return null;
  return new ChatService(db).ensureDirectSpace(
    orgId,
    { type: "employee", id: employee.id },
    { type: "agent", id: ceo.id },
  );
}
