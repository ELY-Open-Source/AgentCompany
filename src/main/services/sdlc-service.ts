import type { DatabaseSync } from "node:sqlite";
import type { SetPrBotGateInput } from "../../shared/commands";
import { PR_BOT_GATE_KEY } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { AuditService } from "./audit-service";

const PR_BOT_GATES = [
  { key: PR_BOT_GATE_KEY.STATIC_CHECKS, label: "Static checks", gateType: "typecheck_lint_test" },
  { key: PR_BOT_GATE_KEY.MIGRATION_DIFF, label: "Migration diff", gateType: "schema_review" },
  { key: PR_BOT_GATE_KEY.POLICY_DIFF, label: "Policy diff", gateType: "policy_review" },
  { key: PR_BOT_GATE_KEY.HUMAN_APPROVAL, label: "Human approval", gateType: "approval_required" },
] as const;

export class SdlcService {
  private readonly audit: AuditService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
  }

  seedOrganizationSdlc(orgId: string, now: string): void {
    for (const gate of PR_BOT_GATES) {
      this.db.prepare(`
        insert into pr_bot_gates(id, org_id, key, label, gate_type, enabled, created_at, updated_at)
        values (?, ?, ?, ?, ?, 1, ?, ?)
        on conflict(org_id, key) do nothing
      `).run(createId("pbg"), orgId, gate.key, gate.label, gate.gateType, now, now);
    }
  }

  setPrBotGate(input: SetPrBotGateInput): void {
    const gate = this.db.prepare("select key from pr_bot_gates where id = ? and org_id = ?")
      .get(input.gateId, input.orgId) as { key: string } | undefined;
    if (!gate) throw new Error("PR bot gate was not found.");
    const now = new Date().toISOString();
    const result = this.db.prepare("update pr_bot_gates set enabled = ?, updated_at = ? where id = ? and org_id = ?")
      .run(input.enabled ? 1 : 0, now, input.gateId, input.orgId);
    if (result.changes === 0) throw new Error("PR bot gate was not found.");
    this.audit.record({
      orgId: input.orgId,
      entityType: "pr_bot_gate",
      entityId: input.gateId,
      actorType: "system",
      actorId: null,
      action: "updated",
      payload: { key: gate.key, enabled: input.enabled },
    });
  }
}
