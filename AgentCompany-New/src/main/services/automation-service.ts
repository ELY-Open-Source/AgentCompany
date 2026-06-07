import type { DatabaseSync } from "node:sqlite";
import type { CreateAutomationRuleInput, UpdateAutomationRuleInput, DeleteAutomationRuleInput } from "../../shared/commands";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";

export class AutomationService {
  private readonly audit: AuditService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
  }

  create(input: CreateAutomationRuleInput): string {
    const id = createId("aut");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into automation_rules(id, org_id, name, trigger_event, condition_json, action_type, action_config_json, priority, enabled, fire_count, created_at, updated_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(id, input.orgId, input.name.trim(), input.triggerEvent, JSON.stringify(input.conditions), input.actionType, JSON.stringify(input.actionConfig), input.priority, input.enabled ? 1 : 0, now, now);
    this.audit.record({
      orgId: input.orgId,
      entityType: "automation_rule",
      entityId: id,
      actorType: "system",
      actorId: null,
      action: "created",
      payload: { name: input.name.trim(), triggerEvent: input.triggerEvent },
    });
    return id;
  }

  update(input: UpdateAutomationRuleInput): void {
    const result = this.db.prepare(`
      update automation_rules set name = ?, trigger_event = ?, condition_json = ?, action_type = ?, action_config_json = ?, priority = ?, enabled = ?, updated_at = ?
      where id = ? and org_id = ?
    `).run(input.name.trim(), input.triggerEvent, JSON.stringify(input.conditions), input.actionType, JSON.stringify(input.actionConfig), input.priority, input.enabled ? 1 : 0, new Date().toISOString(), input.ruleId, input.orgId);
    if (result.changes === 0) throw new Error("Automation rule was not found.");
  }

  delete(input: DeleteAutomationRuleInput): void {
    const result = this.db.prepare("delete from automation_rules where id = ? and org_id = ?").run(input.ruleId, input.orgId);
    if (result.changes === 0) throw new Error("Automation rule was not found.");
  }
}
