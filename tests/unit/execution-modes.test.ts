import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { dispatchAgentTool, type AgentToolContext } from "../../src/main/services/agent-tools";
import { ApprovalService } from "../../src/main/services/approval-service";
import { runJournalLines } from "../../src/main/services/run-journal";
import { DocumentService } from "../../src/main/services/document-service";
import { approvalDrifts } from "../../src/main/services/approval-drift";
import { executionApprovalProblem, requireAssignedAgent } from "../../src/main/services/task-run-preparation";
import { TASK_PRIORITY } from "../../src/shared/domain";
import type { TaskExecutionTaskRow } from "../../src/main/services/task-prompts";

function call(name: string, args: Record<string, unknown>) {
  return { id: `call_${randomUUID()}`, name, arguments: args };
}

interface Harness {
  connection: DatabaseConnection;
  orgId: string;
  ceoId: string;
  ctx: AgentToolContext;
  deps: { db: DatabaseConnection["db"]; organization: OrganizationService; chat: ChatService };
}

function harness(mode: "ai_ceo" | "ai_cofounder"): Harness {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-mode-${randomUUID()}.db`));
  const organization = new OrganizationService(connection.db);
  const workspaceRoot = join(tmpdir(), `ac-mode-ws-${randomUUID()}`);
  mkdirSync(workspaceRoot, { recursive: true });
  let orgId = "";
  let ceoId = "";
  let workspaceId = "";
  connection.transaction(() => {
    orgId = organization.createOrganization({
      organizationName: "OrbitOps",
      employeeName: "Yang",
      mission: "m",
      goal: "g",
      executionMode: mode,
      autoApproveHires: mode === "ai_ceo",
      reviewDeliverables: mode === "ai_cofounder",
    });
    const providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
    ceoId = organization.createAgent({
      orgId, name: "CEO", role: "CEO", department: "Executive",
      modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null, roleLevel: "c_suite",
    });
    workspaceId = organization.createWorkspace({ orgId, name: "HQ", localPath: workspaceRoot, projectId: null });
  });
  return {
    connection,
    orgId,
    ceoId,
    ctx: {
      orgId,
      agent: { id: ceoId, modelProviderId: null, modelId: null },
      taskProjectId: null,
      taskGoalId: null, taskId: null, sourceThreadId: null,
      workspace: { id: workspaceId, localPath: workspaceRoot, writeAccess: true },
    },
    deps: { db: connection.db, organization, chat: new ChatService(connection.db) },
  };
}

function pendingApprovals(h: Harness, kind: string): Array<{ state: string; source_entity_type: string | null }> {
  return h.connection.db.prepare(
    "select state, source_entity_type from approvals where org_id = ? and kind = ?",
  ).all(h.orgId, kind) as Array<{ state: string; source_entity_type: string | null }>;
}

describe("execution modes", () => {
  test("AI Co-Founder mode holds every deliverable and document until the board approves it", () => {
    const h = harness("ai_cofounder");
    const db = h.connection.db;
    const root = h.ctx.workspace!.localPath;
    const wrote = dispatchAgentTool(h.deps, h.ctx, call("write_deliverable", { path: "plan/business-plan.md", content: "# Plan" }));
    expect(wrote).toContain("held for board review");
    const doc = dispatchAgentTool(h.deps, h.ctx, call("create_document", { title: "Launch memo", doc_type: "memo", content: "Ship it." }));
    expect(doc).toContain("held for board review");
    // Nothing exists for anyone to use while the reviews wait.
    expect(existsSync(join(root, "plan", "business-plan.md"))).toBe(false);
    expect(db.prepare("select count(*) as n from documents where org_id = ?").get(h.orgId)).toEqual({ n: 0 });

    const reviews = db.prepare("select id, state, source_entity_type, details from approvals where org_id = ? and kind = 'deliverable_review' order by rowid").all(h.orgId) as Array<{ id: string; state: string; source_entity_type: string; details: string }>;
    expect(reviews.map((review) => [review.state, review.source_entity_type])).toEqual([["pending", "held_deliverable"], ["pending", "held_deliverable"]]);
    expect(reviews[0].details).toContain("# Plan");
    expect(reviews[1].details).toContain("Ship it.");
    const employeeId = (db.prepare("select id from employees where org_id = ?").get(h.orgId) as { id: string }).id;
    for (const review of reviews) {
      h.connection.transaction(() => new ApprovalService(db).decide({ orgId: h.orgId, approvalId: review.id, state: "approved", decidedByEmployeeId: employeeId }));
    }
    expect(readFileSync(join(root, "plan", "business-plan.md"), "utf8")).toBe("# Plan");
    expect(db.prepare("select title, content from documents where org_id = ?").all(h.orgId)).toEqual([{ title: "Launch memo", content: "Ship it." }]);

    // Each approval pins what was approved; content changed or removed later, even outside the app, shows against it.
    expect(approvalDrifts(db, h.orgId)).toEqual({});
    const [fileReview, docReview] = reviews.map((review) => review.id);
    writeFileSync(join(root, "plan", "business-plan.md"), "# Edited by hand");
    expect(approvalDrifts(db, h.orgId)).toEqual({ [fileReview]: "changed" });
    rmSync(join(root, "plan", "business-plan.md"));
    const docId = (db.prepare("select id from documents where org_id = ?").get(h.orgId) as { id: string }).id;
    h.connection.transaction(() => new DocumentService(db).update({ orgId: h.orgId, documentId: docId, title: "Launch memo", content: "Ship it later.", status: "draft", reason: "edit", changedByType: "employee", changedById: employeeId }));
    expect(approvalDrifts(db, h.orgId)).toEqual({ [fileReview]: "removed", [docReview]: "changed" });
  });

  test("a declined deliverable is never written, and held work keeps its task open", () => {
    const h = harness("ai_cofounder");
    const db = h.connection.db;
    const employeeId = (db.prepare("select id from employees where org_id = ?").get(h.orgId) as { id: string }).id;
    const taskId = h.connection.transaction(() => h.deps.organization.createTask({
      orgId: h.orgId, title: "Write the plan", description: "d", status: "in_progress", assigneeAgentId: h.ceoId, risk: "low",
      projectId: null, goalId: null, workspaceId: null, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: false,
    }));
    const ctx = { ...h.ctx, taskId };
    dispatchAgentTool(h.deps, ctx, call("write_deliverable", { path: "plan.md", content: "draft" }));
    const finish = () => h.deps.organization.agentSetTaskStatus({ orgId: h.orgId, taskId, status: "done", agentId: h.ceoId, evidence: "plan.md" });
    expect(finish).toThrow('"Write the plan" has work awaiting board review (plan.md); it is not written yet, so the task cannot be done.');
    const review = (db.prepare("select id from approvals where org_id = ? and kind = 'deliverable_review'").get(h.orgId) as { id: string }).id;
    h.connection.transaction(() => new ApprovalService(db).decide({ orgId: h.orgId, approvalId: review, state: "declined", decidedByEmployeeId: employeeId }));
    expect(existsSync(join(h.ctx.workspace!.localPath, "plan.md"))).toBe(false);
    expect(db.prepare("select state from held_deliverables").get()).toEqual({ state: "declined" });
    finish();
  });

  test("a declined deliverable sends its task back to work, with the board's reason in the next session", () => {
    const h = harness("ai_cofounder");
    const db = h.connection.db;
    const employeeId = (db.prepare("select id from employees where org_id = ?").get(h.orgId) as { id: string }).id;
    const taskId = h.connection.transaction(() => h.deps.organization.createTask({
      orgId: h.orgId, title: "Write the plan", description: "d", status: "in_progress", assigneeAgentId: h.ceoId, risk: "low",
      projectId: null, goalId: null, workspaceId: null, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: false,
    }));
    dispatchAgentTool(h.deps, { ...h.ctx, taskId }, call("write_deliverable", { path: "plan.md", content: "draft" }));
    // The operator closed the task while the draft waited; declining it still reopens the work.
    h.connection.transaction(() => h.deps.organization.updateTaskStatus(h.orgId, taskId, "done"));
    const review = (db.prepare("select id from approvals where org_id = ? and kind = 'deliverable_review'").get(h.orgId) as { id: string }).id;
    h.connection.transaction(() => new ApprovalService(db).decide({ orgId: h.orgId, approvalId: review, state: "declined", decidedByEmployeeId: employeeId, notes: "Cite the market data." }));
    expect(db.prepare("select status from tasks where id = ?").get(taskId)).toEqual({ status: "in_progress" });
    expect(runJournalLines(db, taskId).join("\n")).toContain("The board declined plan.md: Cite the market data. Redo it before closing the task.");
    // Another deliverable under the same name elsewhere does not answer the decline; a resubmission of the same one does.
    const elsewhere = join(h.ctx.workspace!.localPath, "other");
    mkdirSync(elsewhere);
    dispatchAgentTool(h.deps, { ...h.ctx, taskId, workspace: { id: "wsp_other", localPath: elsewhere, writeAccess: true } }, call("write_deliverable", { path: "plan.md", content: "x" }));
    expect(runJournalLines(db, taskId).join("\n")).toContain("The board declined plan.md");
    dispatchAgentTool(h.deps, { ...h.ctx, taskId }, call("write_deliverable", { path: "./plan.md", content: "with data" }));
    expect(runJournalLines(db, taskId).join("\n")).not.toContain("The board declined plan.md");
  });

  test("an approved file whose registration fails leaves the workspace as it was", () => {
    const h = harness("ai_cofounder");
    const db = h.connection.db;
    const root = h.ctx.workspace!.localPath;
    writeFileSync(join(root, "kept.md"), "old");
    dispatchAgentTool(h.deps, h.ctx, call("write_deliverable", { path: "kept.md", content: "new" }));
    dispatchAgentTool(h.deps, h.ctx, call("write_deliverable", { path: "fresh.md", content: "new" }));
    db.exec("create trigger registry_down before insert on file_objects begin select raise(abort, 'registry down'); end;");
    const employeeId = (db.prepare("select id from employees where org_id = ?").get(h.orgId) as { id: string }).id;
    for (const review of db.prepare("select id from approvals where kind = 'deliverable_review'").all() as Array<{ id: string }>) {
      expect(() => h.connection.transaction(() => new ApprovalService(db).decide({ orgId: h.orgId, approvalId: review.id, state: "approved", decidedByEmployeeId: employeeId })))
        .toThrow("registry down");
    }
    expect(readFileSync(join(root, "kept.md"), "utf8")).toBe("old");
    expect(existsSync(join(root, "fresh.md"))).toBe(false);
    expect(db.prepare("select state from held_deliverables order by rowid").all()).toEqual([{ state: "held" }, { state: "held" }]);
    // A failing state change is caught before anything is written.
    db.exec("drop trigger registry_down; create trigger held_down before update on held_deliverables begin select raise(abort, 'held store down'); end;");
    const first = (db.prepare("select id from approvals where kind = 'deliverable_review' order by rowid").get() as { id: string }).id;
    expect(() => h.connection.transaction(() => new ApprovalService(db).decide({ orgId: h.orgId, approvalId: first, state: "approved", decidedByEmployeeId: employeeId })))
      .toThrow("held store down");
    expect(readFileSync(join(root, "kept.md"), "utf8")).toBe("old");
  });

  test("a held document update is refused at approval if the document moved on meanwhile", () => {
    const h = harness("ai_ceo");
    const db = h.connection.db;
    const created = dispatchAgentTool(h.deps, h.ctx, call("create_document", { title: "Memo", doc_type: "memo", content: "v1" }));
    const docId = /doc_id=([^,]+)/.exec(created)![1];
    db.prepare("update organizations set review_deliverables = 1 where id = ?").run(h.orgId);
    expect(dispatchAgentTool(h.deps, h.ctx, call("update_document", { doc_id: docId, content: "v2 draft", reason: "tighten" }))).toContain("held for board review");
    expect(db.prepare("select version, content from documents where id = ?").get(docId)).toEqual({ version: 1, content: "v1" });
    db.prepare("update documents set version = 2 where id = ?").run(docId);
    const employeeId = (db.prepare("select id from employees where org_id = ?").get(h.orgId) as { id: string }).id;
    const review = (db.prepare("select id from approvals where org_id = ? and kind = 'deliverable_review'").get(h.orgId) as { id: string }).id;
    expect(() => h.connection.transaction(() => new ApprovalService(db).decide({ orgId: h.orgId, approvalId: review, state: "approved", decidedByEmployeeId: employeeId })))
      .toThrow("The document moved from v1 to v2 after this draft was held; decline the review and ask for a fresh draft.");
    expect(db.prepare("select state from approvals where id = ?").get(review)).toEqual({ state: "pending" });
  });

  test("a task without file access cannot write files, directly or by holding them for review", () => {
    for (const mode of ["ai_ceo", "ai_cofounder"] as const) {
      const h = harness(mode);
      const readOnly = { ...h.ctx, workspace: { ...h.ctx.workspace!, writeAccess: false } };
      expect(dispatchAgentTool(h.deps, readOnly, call("write_deliverable", { path: "notes.md", content: "x" })))
        .toBe("ERROR: This task has read-only workspace access, so it cannot write files. Put the output in a document (create_document), or ask for a task with requires_filesystem, which the operator approves.");
      expect(existsSync(join(h.ctx.workspace!.localPath, "notes.md"))).toBe(false);
      expect(h.connection.db.prepare("select count(*) as n from held_deliverables").get()).toEqual({ n: 0 });
    }
  });

  test("AI CEO mode ships deliverables without review", () => {
    const h = harness("ai_ceo");
    const wrote = dispatchAgentTool(h.deps, h.ctx, call("write_deliverable", { path: "plan/business-plan.md", content: "# Plan" }));
    expect(wrote).not.toContain("board review");
    dispatchAgentTool(h.deps, h.ctx, call("create_document", { title: "Launch memo", doc_type: "memo", content: "Ship it." }));
    expect(pendingApprovals(h, "deliverable_review")).toHaveLength(0);
  });

  test("AI Co-Founder mode holds above-threshold hires; AI CEO mode clears them", () => {
    // Hiring policies require review above $5,000/month; the mode decides
    // whether that review waits for the operator or clears automatically.
    const hireAva = (h: Harness) => {
      const providerId = (h.connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(h.orgId) as { id: string }).id;
      h.connection.transaction(() => h.deps.organization.createAgent({
        orgId: h.orgId, name: "Ava", role: "Designer", department: "Product",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 600000, managerAgentId: h.ceoId,
      }));
    };

    const cofounder = harness("ai_cofounder");
    hireAva(cofounder);
    const held = cofounder.connection.db.prepare(
      "select state from approvals where org_id = ? and kind = 'agent_hire' and title like '%Ava%'",
    ).get(cofounder.orgId) as { state: string };
    expect(held.state).toBe("pending");

    const ceoMode = harness("ai_ceo");
    hireAva(ceoMode);
    const cleared = ceoMode.connection.db.prepare(
      "select state from approvals where org_id = ? and kind = 'agent_hire' and title like '%Ava%'",
    ).get(ceoMode.orgId) as { state: string };
    expect(cleared.state).toBe("approved");
  });

  test("a hire held for review is not on staff until approved, and a declined one never is", () => {
    const h = harness("ai_cofounder");
    const db = h.connection.db;
    const providerId = (db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(h.orgId) as { id: string }).id;
    const hire = (name: string) => h.connection.transaction(() => h.deps.organization.createAgent({
      orgId: h.orgId, name, role: "Designer", department: "Product",
      modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 600000, managerAgentId: h.ceoId,
    }));
    const lifecycle = (id: string) => (db.prepare("select lifecycle from agents where id = ?").get(id) as { lifecycle: string }).lifecycle;
    const identities = (id: string) => (db.prepare("select count(*) as n from service_identities where agent_id = ?").get(id) as { n: number }).n;
    const memberships = (id: string) => (db.prepare("select count(*) as n from chat_memberships where principal_type = 'agent' and principal_id = ?").get(id) as { n: number }).n;
    const runAs = (id: string) => requireAssignedAgent(db, h.orgId, { assignee_agent_id: id } as TaskExecutionTaskRow);
    const approvalOf = (name: string) => (db.prepare("select id from approvals where org_id = ? and kind = 'agent_hire' and title = ?").get(h.orgId, `Review hire: ${name}`) as { id: string }).id;
    const employeeId = (db.prepare("select id from employees where org_id = ?").get(h.orgId) as { id: string }).id;
    const approvals = new ApprovalService(db);

    const ava = hire("Ava");
    expect([lifecycle(ava), identities(ava), memberships(ava)]).toEqual(["pending_hire", 0, 0]);
    expect(() => runAs(ava)).toThrow("Ava is not hired yet: the hire awaits approval.");
    expect(() => hire("ava")).toThrow('An agent named "ava" is already on staff or awaiting approval. Pick a different name.');
    const channel = h.connection.transaction(() => h.deps.chat.createSpace({ orgId: h.orgId, name: "design", topic: "t", spaceType: "project", visibility: "workspace" }));
    expect(memberships(ava)).toBe(0);
    expect(() => h.connection.transaction(() => h.deps.chat.createSpace({ orgId: h.orgId, name: "ava-room", topic: "t", spaceType: "project", visibility: "restricted", memberAgentIds: [ava] })))
      .toThrow("Ava is not on staff, so cannot join a channel.");
    expect(channel).toBeTruthy();
    h.connection.transaction(() => approvals.decide({ orgId: h.orgId, approvalId: approvalOf("Ava"), state: "approved", decidedByEmployeeId: employeeId }));
    expect(lifecycle(ava)).toBe("active");
    expect(identities(ava)).toBe(1);
    expect(memberships(ava)).toBeGreaterThan(0);
    expect(runAs(ava).id).toBe(ava);

    const bo = hire("Bo");
    h.connection.transaction(() => approvals.decide({ orgId: h.orgId, approvalId: approvalOf("Bo"), state: "declined", decidedByEmployeeId: employeeId }));
    expect([lifecycle(bo), identities(bo), memberships(bo)]).toEqual(["declined", 0, 0]);
    expect(() => runAs(bo)).toThrow("Bo's hire was declined; reassign the task.");
  });

  test("a task approval covers the content it was given; an edit needs a fresh one", () => {
    const h = harness("ai_cofounder");
    const db = h.connection.db;
    const employeeId = (db.prepare("select id from employees where org_id = ?").get(h.orgId) as { id: string }).id;
    const approvals = new ApprovalService(db);
    const taskId = h.connection.transaction(() => h.deps.organization.createTask({
      orgId: h.orgId, title: "Wipe staging", description: "Drop the staging tables.", status: "backlog",
      assigneeAgentId: h.ceoId, risk: "high", projectId: null, goalId: null, workspaceId: null, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: false,
    }));
    const task = () => db.prepare("select * from tasks where id = ?").get(taskId) as unknown as Parameters<typeof executionApprovalProblem>[2];
    const taskApprovals = () => db.prepare("select id, state, details from approvals where source_entity_id = ? order by rowid").all(taskId) as Array<{ id: string; state: string; details: string }>;
    const edit = (description: string) => h.connection.transaction(() => h.deps.organization.updateTask({
      orgId: h.orgId, taskId, title: "Wipe staging", description, assigneeAgentId: h.ceoId, risk: "high", priority: TASK_PRIORITY.NORMAL, parentTaskId: null,
    }));
    const decide = (id: string) => h.connection.transaction(() => approvals.decide({ orgId: h.orgId, approvalId: id, state: "approved", decidedByEmployeeId: employeeId }));

    // Editing while the review waits replaces it with one for the new content.
    edit("Drop the staging tables, then reseed.");
    expect(taskApprovals().map((row) => [row.state, row.details])).toEqual([
      ["superseded", "Drop the staging tables."],
      ["pending", "Drop the staging tables, then reseed."],
    ]);
    decide(taskApprovals()[1].id);
    expect(executionApprovalProblem(db, h.orgId, task())).toBeNull();

    // An approved task edited afterwards is not covered by the old approval.
    edit("Drop the production tables.");
    expect(executionApprovalProblem(db, h.orgId, task())).toBe("Approved task execution approval is required.");
    expect(taskApprovals().map((row) => row.state)).toEqual(["superseded", "approved", "pending"]);
    // A save that changes nothing approved keeps the approval.
    decide(taskApprovals()[2].id);
    edit("Drop the production tables.");
    expect(taskApprovals()).toHaveLength(3);
    expect(executionApprovalProblem(db, h.orgId, task())).toBeNull();
  });
});
