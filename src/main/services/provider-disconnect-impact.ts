import type { DatabaseSync } from "node:sqlite";
import type { ProviderDisconnectImpact } from "../../shared/commands";

/** What disconnecting a provider stops: its agents cannot work, running sessions stop now, queued ones fail when they start. */
export function providerDisconnectImpact(db: DatabaseSync, orgId: string, providerId: string): ProviderDisconnectImpact {
  if (!db.prepare("select 1 from providers where id = ? and org_id = ?").get(providerId, orgId)) throw new Error("Provider was not found.");
  const agents = (db.prepare("select name from agents where org_id = ? and model_provider_id = ? and lifecycle = 'active' order by name").all(orgId, providerId) as Array<{ name: string }>).map((agent) => agent.name);
  const openTasks = (db.prepare(`
    select count(*) as n from tasks t join agents a on a.id = t.assignee_agent_id
    where t.org_id = ? and a.model_provider_id = ? and a.lifecycle = 'active' and t.status <> 'done' and t.origin is null
  `).get(orgId, providerId) as { n: number }).n;
  const runs = (state: string) => (db.prepare("select count(*) as n from task_runs where org_id = ? and provider_id = ? and state = ?").get(orgId, providerId, state) as { n: number }).n;
  return { agents, openTasks, runningRuns: runs("running"), queuedRuns: runs("queued") };
}
