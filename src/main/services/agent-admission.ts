import type { DatabaseSync } from "node:sqlite";
import { IdentityAccessService } from "./identity-access-service";

/** Puts an agent on staff: a member of every workspace channel, with the service identity its runs act as. */
export function admitAgent(db: DatabaseSync, orgId: string, agentId: string, name: string, now: string): void {
  const spaces = db.prepare("select id from chat_spaces where org_id = ? and visibility = ? and space_type <> ?")
    .all(orgId, "workspace", "direct") as Array<{ id: string }>;
  for (const space of spaces) {
    db.prepare(`
      insert into chat_memberships(space_id, principal_type, principal_id, role, mute_state)
      values (?, ?, ?, ?, ?)
      on conflict(space_id, principal_type, principal_id) do nothing
    `).run(space.id, "agent", agentId, "member", "unmuted");
  }
  new IdentityAccessService(db).createAgentServiceIdentity(orgId, agentId, name, now);
}

/** Carries out a hire decision: an approved pending hire joins the staff; a declined hire, pending or already working, leaves it. */
export function settleHire(db: DatabaseSync, orgId: string, agentId: string, approved: boolean): void {
  const agent = db.prepare("select name, lifecycle from agents where id = ? and org_id = ?")
    .get(agentId, orgId) as { name: string; lifecycle: string } | undefined;
  if (!agent) throw new Error("The agent of this hire review was not found.");
  if (approved) {
    if (agent.lifecycle !== "pending_hire") return;
    db.prepare("update agents set lifecycle = 'active' where id = ?").run(agentId);
    admitAgent(db, orgId, agentId, agent.name, new Date().toISOString());
    console.info(`[hiring] ${agent.name} (${agentId}) joined after approval`);
    return;
  }
  db.prepare("update agents set lifecycle = 'declined' where id = ?").run(agentId);
  console.info(`[hiring] ${agent.name} (${agentId}) was declined (was ${agent.lifecycle})`);
}
