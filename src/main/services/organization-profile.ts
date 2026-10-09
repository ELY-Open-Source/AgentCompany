import type { DatabaseSync } from "node:sqlite";
import type { UpdateOrganizationInput } from "../../shared/commands";
import { AuditService } from "./audit-service";

/** Changes the profile and how the company runs; requests already waiting keep their state, new work follows the new settings. */
export function updateOrganizationProfile(db: DatabaseSync, input: UpdateOrganizationInput): void {
  const name = input.name.trim();
  if (!name) throw new Error("The company needs a name.");
  const before = db.prepare(`
    select name, description, mission, goal, execution_mode, auto_approve_hires, review_deliverables from organizations where id = ?
  `).get(input.orgId) as { name: string; description: string; mission: string; goal: string; execution_mode: string; auto_approve_hires: number; review_deliverables: number } | undefined;
  if (!before) throw new Error("Organization was not found.");
  const next = {
    name, description: input.description.trim(), mission: input.mission.trim(), goal: input.goal.trim(),
    executionMode: input.executionMode, autoApproveHires: input.autoApproveHires, reviewDeliverables: input.reviewDeliverables,
  };
  const previous = {
    name: before.name, description: before.description, mission: before.mission, goal: before.goal,
    executionMode: before.execution_mode, autoApproveHires: before.auto_approve_hires === 1, reviewDeliverables: before.review_deliverables === 1,
  };
  const changed = (Object.keys(next) as Array<keyof typeof next>).filter((key) => next[key] !== previous[key]);
  db.prepare(`
    update organizations set name = ?, description = ?, mission = ?, goal = ?, execution_mode = ?, auto_approve_hires = ?, review_deliverables = ?
    where id = ?
  `).run(next.name, next.description, next.mission, next.goal, next.executionMode, next.autoApproveHires ? 1 : 0, next.reviewDeliverables ? 1 : 0, input.orgId);
  console.info(`[organization] ${input.orgId} updated: ${changed.join(", ") || "nothing changed"}`);
  new AuditService(db).record({ orgId: input.orgId, entityType: "organization", entityId: input.orgId, actorType: "employee", actorId: null, action: "updated", payload: { changed, ...Object.fromEntries(changed.map((key) => [key, next[key]])) } });
}
