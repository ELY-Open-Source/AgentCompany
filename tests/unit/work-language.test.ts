import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { dispatchAgentTool } from "../../src/main/services/agent-tools";
import { taskWorkLanguage } from "../../src/main/services/work-language";
import { workLanguageSchema } from "../../src/main/database/migrations/104-work-language";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS, WRITING_MODE } from "../../src/shared/domain";

describe("the working language", () => {
  test("is the company's unless a task sets its own, and delegated work keeps its parent's", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-work-language-${randomUUID()}.db`));
    const db = connection.db;
    const organization = new OrganizationService(db);
    let orgId = "";
    let ceoId = "";
    let taskId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Yang", mission: "m", goal: "g" });
      ceoId = organization.createAgent({ orgId, name: "CEO", role: "CEO", department: "Executive", modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: null, roleLevel: "c_suite" });
      taskId = organization.createTask({
        orgId, title: "Plan", description: "d", status: TASK_STATUS.IN_PROGRESS, assigneeAgentId: ceoId, risk: RISK_LEVEL.LOW,
        projectId: null, goalId: null, workspaceId: null, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: false,
      });
    });
    expect(taskWorkLanguage(db, orgId, taskId)).toBe("en");

    // The display language plays no part.
    organization.updateUiPreferences({ language: "zh" });
    expect(taskWorkLanguage(db, orgId, taskId)).toBe("en");

    organization.updateOrganization({
      orgId, name: "Acme", description: "", mission: "m", goal: "g", executionMode: "ai_ceo", autoApproveHires: true, reviewDeliverables: false, workLanguage: "zh",
    });
    expect(taskWorkLanguage(db, orgId, taskId)).toBe("zh");

    const edit = (workLanguage: "en" | "zh" | null) => connection.transaction(() => organization.updateTask({
      orgId, taskId, title: "Plan", description: "d", assigneeAgentId: ceoId, risk: RISK_LEVEL.LOW, priority: TASK_PRIORITY.NORMAL,
      parentTaskId: null, projectId: null, goalId: null, workspaceId: null, requiresFilesystem: false, writingMode: WRITING_MODE.CONVERSATIONAL, workLanguage,
    }));
    edit("en");
    expect(taskWorkLanguage(db, orgId, taskId)).toBe("en");

    const delegated = dispatchAgentTool({ db, organization, chat: new ChatService(db) }, {
      orgId, agent: { id: ceoId, modelProviderId: null, modelId: null }, taskProjectId: null, taskGoalId: null, taskId, sourceThreadId: null, workspace: null,
    }, { id: "call_1", name: "create_task", arguments: { title: "Draft", description: "d" } });
    const childId = /task_id=([^)\s]+)\)/.exec(delegated)![1];
    expect(db.prepare("select work_language from tasks where id = ?").get(childId)).toEqual({ work_language: "en" });

    edit(null);
    expect(taskWorkLanguage(db, orgId, taskId)).toBe("zh");
  });

  test("an existing company keeps the language its agents had, taken from the app setting", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      create table schema_migrations(version integer, name text, applied_at text);
      create table app_state(id integer primary key, language text);
      create table organizations(id text primary key);
      create table tasks(id text primary key, org_id text);
      insert into app_state(id, language) values (1, 'zh');
      insert into organizations(id) values ('org_a');
    `);
    db.exec(workLanguageSchema);
    expect(db.prepare("select work_language from organizations").get()).toEqual({ work_language: "zh" });
  });
});
