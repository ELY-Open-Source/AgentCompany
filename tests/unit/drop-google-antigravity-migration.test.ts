import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { dropGoogleAntigravitySchema } from "../../src/main/database/migrations/111-drop-google-antigravity";
import { OrganizationService } from "../../src/main/services/organization-service";

describe("dropping Google Antigravity", () => {
  test("removes its providers, frees agents and the auditor, erases its secrets and key", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-drop-ag-${randomUUID()}.db`));
    const db = connection.db;
    const organization = new OrganizationService(db);
    let orgId = "";
    let agentId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Yang", mission: "m", goal: "g" });
      db.exec(`
        create temp table ag as select * from providers where org_id = '${orgId}' and provider_key = 'openai';
        update ag set id = 'prov_ag', provider_key = 'google-antigravity', label = 'Google Antigravity', credential_id = 'cred_ag';
      `);
      db.prepare("insert into credentials(id, org_id, provider_key, kind, ciphertext, display_hint, created_at) values ('cred_ag', ?, 'google-antigravity', 'oauth', x'0102', 'g', datetime('now'))").run(orgId);
      db.exec("insert into providers select * from ag");
      agentId = organization.createAgent({ orgId, name: "Ada", role: "Engineer", department: "Engineering", modelProviderId: "prov_ag", modelId: "gemini-3-flash", budgetCents: 1000, managerAgentId: null });
      db.prepare("update organizations set audit_provider_id = 'prov_ag' where id = ?").run(orgId);
      db.prepare("insert into integration_keys(name, ciphertext, updated_at) values ('google_antigravity_client_secret', x'01', datetime('now'))").run();
      db.prepare("update app_state set onboarding_draft_json = ? where id = 1").run(JSON.stringify({ step: "mission", companyName: "Next", providerKey: "google-antigravity", providerModel: "gemini-3-flash", providerBaseUrl: "" }));
    });

    db.exec(dropGoogleAntigravitySchema);

    expect(db.prepare("select count(*) as n from providers where provider_key = 'google-antigravity'").get()).toEqual({ n: 0 });
    expect(db.prepare("select model_provider_id, model_id from agents where id = ?").get(agentId)).toEqual({ model_provider_id: null, model_id: null });
    expect(db.prepare("select audit_provider_id from organizations where id = ?").get(orgId)).toEqual({ audit_provider_id: null });
    expect(db.prepare("select length(ciphertext) as bytes from credentials where id = 'cred_ag'").get()).toEqual({ bytes: 0 });
    expect(db.prepare("select count(*) as n from integration_keys").get()).toEqual({ n: 0 });
    expect(db.prepare("select count(*) as n from providers where provider_key = 'openai'").get()).toEqual({ n: 1 });
    const draft = JSON.parse((db.prepare("select onboarding_draft_json from app_state where id = 1").get() as { onboarding_draft_json: string }).onboarding_draft_json);
    expect(draft).toEqual({ step: "provider", companyName: "Next", providerKey: "openai", providerModel: "gpt-6.1-sol", providerBaseUrl: "" });
    connection.close();
  });
});
