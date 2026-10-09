import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OnboardingService } from "../../src/main/services/onboarding-service";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { ChatService } from "../../src/main/services/chat-service";
import { dispatchAgentTool } from "../../src/main/services/agent-tools";
import { COMPANY_PRESETS } from "../../src/shared/company-presets";

const vault = { encryptSecret: (secret: string) => Buffer.from(secret, "utf8"), decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8") };

describe("what onboarding shows is what a company gets", () => {
  test("a new company is seeded with exactly the presets onboarding lists", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-presets-${randomUUID()}.db`));
    const db = connection.db;
    const providers = new ProviderService(db, providerAdapters, vault);
    const onboarding = new OnboardingService({ db, saveProviderCredential: (input) => providers.saveCredential(input) });
    let orgId = "";
    let ceoId = "";
    connection.transaction(() => {
      const summary = onboarding.bootstrap({
        companyName: "FlowPilot", companyDescription: "d", employeeName: "Yang", workspacePath: "", executionMode: "ai_cofounder", autoApproveHires: false,
        reviewDeliverables: true, goalTitle: "Ship.", goalDescription: "d", providerKey: "openai", providerSecret: "sk-test", providerModel: "gpt-5.4",
      });
      orgId = summary.orgId;
      ceoId = summary.ceoAgentId;
    });
    expect(db.prepare("select budget_cents from agents where id = ?").get(ceoId)).toEqual({ budget_cents: COMPANY_PRESETS.ceoBudgetCents });
    expect(db.prepare("select distinct max_headcount, monthly_budget_limit_cents, require_approval_above_cents from hiring_policies where org_id = ?").all(orgId))
      .toEqual([{ max_headcount: COMPANY_PRESETS.departmentHeadcount, monthly_budget_limit_cents: COMPANY_PRESETS.departmentBudgetCents, require_approval_above_cents: COMPANY_PRESETS.hireReviewAboveCents }]);
    expect(db.prepare("select distinct monthly_request_limit from providers where org_id = ?").all(orgId)).toEqual([{ monthly_request_limit: COMPANY_PRESETS.providerMonthlyRequests }]);
    expect(db.prepare("select risk_ceiling from policy_rules where org_id = ? and action = 'task_create'").all(orgId)).toEqual([{ risk_ceiling: COMPANY_PRESETS.taskRiskCeiling }]);

    const hired = dispatchAgentTool({ db, organization: new OrganizationService(db), chat: new ChatService(db) }, {
      orgId, agent: { id: ceoId, modelProviderId: (db.prepare("select model_provider_id from agents where id = ?").get(ceoId) as { model_provider_id: string }).model_provider_id, modelId: null }, taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: null,
    }, { id: "call_1", name: "hire_agent", arguments: { name: "Ada", role: "Engineer", title: "Engineer", department: "Engineering", seniority: "staff" } });
    expect(hired).toContain("Ada");
    expect(db.prepare("select budget_cents from agents where org_id = ? and name = 'Ada'").get(orgId)).toEqual({ budget_cents: COMPANY_PRESETS.agentHireBudgetCents });
  });
});
