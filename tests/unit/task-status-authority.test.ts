import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentLinks } from "../helpers/task-links";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { dispatchAgentTool, type AgentToolContext } from "../../src/main/services/agent-tools";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS } from "../../src/shared/domain";

function setup() {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-authority-${randomUUID()}.db`));
  const organization = new OrganizationService(connection.db);
  let orgId = "";
  const ids: Record<string, string> = {};
  connection.transaction(() => {
    orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
    ids.ceo = organization.createAgent({ orgId, name: "Cleo", role: "CEO", department: "Executive", modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: null, roleLevel: "c_suite" });
    ids.cto = organization.createAgent({ orgId, name: "Tara", role: "CTO", department: "Engineering", modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: ids.ceo, roleLevel: "director" });
    ids.dev = organization.createAgent({ orgId, name: "Dev", role: "Engineer", department: "Engineering", modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: ids.cto });
    ids.peer = organization.createAgent({ orgId, name: "Pia", role: "Engineer", department: "Engineering", modelProviderId: null, modelId: null, budgetCents: 1000, managerAgentId: ids.cto });
    ids.task = organization.createTask({
      orgId, title: "Login page", description: "Build it.", status: TASK_STATUS.IN_PROGRESS, assigneeAgentId: ids.dev,
      risk: RISK_LEVEL.LOW, projectId: null, goalId: null, workspaceId: null, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: false,
    });
  });
  const deps = { db: connection.db, organization, chat: new ChatService(connection.db) };
  const as = (agent: string, args: Record<string, unknown>) => {
    const ctx: AgentToolContext = { orgId, agent: { id: ids[agent], modelProviderId: null, modelId: null }, taskProjectId: null, taskGoalId: null, taskId: null, sourceThreadId: null, workspace: null };
    return dispatchAgentTool(deps, ctx, { id: `c_${randomUUID()}`, name: "update_task_status", arguments: { task_id: ids.task, ...args } });
  };
  const status = () => (connection.db.prepare("select status from tasks where id = ?").get(ids.task) as { status: string }).status;
  return { connection, organization, orgId, ids, as, status };
}

describe("task status authority", () => {
  test("only the assignee, their managers or the reviewer move a task, and done needs evidence and sign-off", () => {
    const h = setup();
    expect(h.as("peer", { status: "done", evidence: "x" })).toBe('ERROR: Only Dev, their managers or the open reviewer can change "Login page".');
    expect(h.as("dev", { status: "done" })).toBe('ERROR: "evidence" is required to move work to review or done: say what was produced and where (file_ids, document ids, test results).');
    expect(h.status()).toBe("in_progress");

    expect(h.as("dev", { status: "done", evidence: "file_id=fil_1, tests pass" }))
      .toBe(`Task ${h.ids.task} moved to review: done needs sign-off from your manager. Tara will review it.`);
    expect(h.status()).toBe("review");
    const review = h.connection.db.prepare("select description from tasks where review_of_task_id = ?").get(h.ids.task) as { description: string };
    expect(review.description).toContain("Evidence given: file_id=fil_1, tests pass");

    expect(h.as("ceo", { status: "done", evidence: "Checked the page and the passing tests." })).toBe(`Task ${h.ids.task} moved to done.`);
    const audit = h.connection.db.prepare("select actor_type, actor_id, json_extract(payload_json, '$.evidence') as evidence from audit_events where entity_id = ? and action = 'status_changed' order by rowid desc limit 1").get(h.ids.task);
    expect(audit).toEqual({ actor_type: "agent", actor_id: h.ids.ceo, evidence: "Checked the page and the passing tests." });
    h.connection.close();
  });

  test("a reviewer reassigned the work still needs their own manager; repeats and review vehicles never loop", () => {
    const h = setup();
    expect(h.as("dev", { status: "backlog", evidence: 123 })).toBe('ERROR: "evidence" is required.');
    h.as("dev", { status: "done", evidence: "file_id=fil_1" });
    const reviewId = (h.connection.db.prepare("select id from tasks where review_of_task_id = ?").get(h.ids.task) as { id: string }).id;
    h.organization.updateTask({ workLanguage: null, orgId: h.orgId, taskId: h.ids.task, title: "Login page", description: "Build it.", assigneeAgentId: h.ids.cto, risk: RISK_LEVEL.LOW, priority: TASK_PRIORITY.NORMAL, parentTaskId: null, ...currentLinks(h.connection.db, h.ids.task) });
    expect(h.status()).toBe("in_progress");
    expect(h.connection.db.prepare("select status from tasks where id = ?").get(reviewId)).toEqual({ status: "done" });
    expect(h.as("cto", { status: "done", evidence: "Rebuilt the form." })).toBe(`Task ${h.ids.task} moved to review: done needs sign-off from your manager. Cleo will review it.`);
    expect(h.status()).toBe("review");
    const fresh = h.connection.db.prepare("select assignee_agent_id, description from tasks where review_of_task_id = ? and status <> 'done'").get(h.ids.task) as { assignee_agent_id: string; description: string };
    expect(fresh.assignee_agent_id).toBe(h.ids.ceo);
    expect(fresh.description).toContain("Evidence given: Rebuilt the form.");

    expect(h.as("ceo", { status: "done", evidence: "Verified." })).toBe(`Task ${h.ids.task} moved to done.`);
    expect(h.as("cto", { status: "done", evidence: "again" })).toBe(`Task ${h.ids.task} moved to done.`);
    expect(h.status()).toBe("done");

    // The reviewer closing the review task itself closes it directly, without a review of the review.
    h.connection.db.prepare("update tasks set status = 'backlog' where id = ?").run(reviewId);
    h.ids.task = reviewId;
    expect(h.as("cto", { status: "done", evidence: "Reviewed." })).toBe(`Task ${reviewId} moved to done.`);
    expect(h.connection.db.prepare("select count(*) as n from tasks where review_of_task_id = ?").get(reviewId)).toEqual({ n: 0 });
    h.connection.close();
  });
});
