import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OnboardingService } from "../../src/main/services/onboarding-service";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { createId } from "../../src/shared/ids";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

function countFor(db: DatabaseConnection["db"], table: string, orgId: string): number {
  return (db.prepare(`select count(*) as count from ${table} where org_id = ?`).get(orgId) as { count: number }).count;
}

describe("organization deletion", () => {
  test("deleting an organization cascades through credentials, audit events, and social audit records", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-del-${randomUUID()}.db`));
    const providers = new ProviderService(connection.db, providerAdapters, testVault);
    const organization = new OrganizationService(connection.db);
    const onboarding = new OnboardingService({ db: connection.db, saveProviderCredential: (i) => providers.saveCredential(i) });
    const snapshot = new SnapshotService(connection.db);

    let orgId = "";
    let survivorId = "";
    connection.transaction(() => {
      const summary = onboarding.bootstrap({
        companyName: "OrbitOps AI", companyDescription: "AI-run operations company.", employeeName: "Yang",
        workspacePath: "", executionMode: "ai_ceo", autoApproveHires: true, reviewDeliverables: false,
        goalTitle: "Stand up a local service business.", goalDescription: "Win the first paying customers.",
        providerKey: "openai", providerSecret: "sk-test-key", providerModel: "gpt-5.4",
      });
      orgId = summary.orgId;
      survivorId = organization.createOrganization({
        organizationName: "Keepers Inc", employeeName: "Dana", mission: "Stay.", goal: "Persist.",
      });
      organization.setActiveOrganization(orgId);
      // A social audit record is immutable (no-delete trigger); it must still cascade on org teardown.
      connection.db.prepare(`
        insert into social_audit_records(
          id, org_id, social_account_id, source_type, source_id, event_type, actor_type, actor_id,
          policy_decision, evidence_file_id, metadata_json, created_at
        ) values (?, ?, null, 'post', ?, 'created', 'system', null, 'allow', null, '{}', datetime('now'))
      `).run(createId("sar"), orgId, createId("src"));
    });

    // Precondition: every blocking row type is present for the org.
    expect(countFor(connection.db, "audit_events", orgId)).toBeGreaterThan(0);
    expect(countFor(connection.db, "provider_auth_profiles", orgId)).toBeGreaterThan(0);
    expect(countFor(connection.db, "social_audit_records", orgId)).toBe(1);
    expect(countFor(connection.db, "agents", orgId)).toBeGreaterThan(0);

    // The delete must succeed (previously the FK restrict + immutability triggers rolled it back).
    expect(() => connection.transaction(() => organization.deleteOrganization(orgId))).not.toThrow();

    const state = snapshot.load();
    expect(state.organizations.map((o) => o.id)).toEqual([survivorId]);
    expect(state.activeOrgId).toBe(survivorId);
    for (const table of ["audit_events", "provider_auth_profiles", "social_audit_records", "agents", "providers", "credentials", "tasks", "approvals"]) {
      expect(countFor(connection.db, table, orgId)).toBe(0);
    }

    // The immutability trigger still blocks tampering with a living org's audit log.
    const survivorAudit = connection.db.prepare("select id from audit_events where org_id = ? limit 1").get(survivorId) as { id: string };
    expect(() => connection.db.prepare("delete from audit_events where id = ?").run(survivorAudit.id)).toThrow(/immutable/);

    connection.close();
  });
});
