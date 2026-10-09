import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OnboardingService } from "../../src/main/services/onboarding-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { completeSetup, loadOnboardingDraft, saveOnboardingDraft } from "../../src/main/services/onboarding-progress";
import { onboardingProgressSchema } from "../../src/main/database/migrations/105-onboarding-progress";
import type { OnboardingDraft } from "../../src/shared/commands";

const vault = { encryptSecret: (secret: string) => Buffer.from(secret, "utf8"), decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8") };

const draft: OnboardingDraft = {
  step: "mode", companyName: "Resume Co", companyDescription: "d", employeeName: "Dana", workspacePath: "", executionMode: "ai_ceo",
  providerKey: "openai", providerBaseUrl: "", providerModel: "gpt-5.4", goalTitle: "", goalDescription: "",
};

describe("onboarding progress", () => {
  test("the wizard is kept until launch, and a launched company stays unfinished until its setup is done", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-onboarding-progress-${randomUUID()}.db`));
    const db = connection.db;
    expect(loadOnboardingDraft(db)).toBeNull();
    saveOnboardingDraft(db, draft);
    expect(loadOnboardingDraft(db)).toEqual(draft);

    const providers = new ProviderService(db, providerAdapters, vault);
    const onboarding = new OnboardingService({ db, saveProviderCredential: (input) => providers.saveCredential(input) });
    let orgId = "";
    connection.transaction(() => {
      orgId = onboarding.bootstrap({
        companyName: "Resume Co", companyDescription: "d", employeeName: "Dana", workspacePath: "", executionMode: "ai_ceo", autoApproveHires: true,
        reviewDeliverables: false, goalTitle: "Ship.", goalDescription: "d", providerKey: "openai", providerSecret: "sk-test", providerModel: "gpt-5.4",
      }).orgId;
    });
    expect(loadOnboardingDraft(db)).toBeNull();
    expect(db.prepare("select setup_completed_at from organizations where id = ?").get(orgId)).toEqual({ setup_completed_at: null });
    completeSetup(db, orgId);
    const done = (db.prepare("select setup_completed_at from organizations where id = ?").get(orgId) as { setup_completed_at: string }).setup_completed_at;
    expect(done).not.toBeNull();
    completeSetup(db, orgId);
    expect(db.prepare("select setup_completed_at from organizations where id = ?").get(orgId)).toEqual({ setup_completed_at: done });
    expect(() => completeSetup(db, "org_missing")).toThrow("Organization was not found.");
  });

  test("companies that existed before count as set up", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      create table schema_migrations(version integer, name text, applied_at text);
      create table app_state(id integer primary key, updated_at text);
      create table organizations(id text primary key, created_at text);
      insert into organizations(id, created_at) values ('org_a', '2026-01-01T00:00:00.000Z');
    `);
    db.exec(onboardingProgressSchema);
    expect(db.prepare("select setup_completed_at from organizations").get()).toEqual({ setup_completed_at: "2026-01-01T00:00:00.000Z" });
  });
});
