/**
 * Automation rules, agent messages, auto-assignment, and workflow CRUD.
 * Physically extracted from autonomous-chain.spec.ts without behavior changes.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { installSharedSetup } from "./shared-setup";

const shared = installSharedSetup();
const { createAgent } = shared;

describe("Automation Rules CRUD", () => {
  it("creates, reads, toggles, and deletes an automation rule", () => {
    const ruleId = shared.db.automation.rules.saveAutomationRule({
      companyId: shared.companyId,
      name: "Auto-escalate blocked tasks",
      description: "When a task is blocked, notify the manager",
      trigger: "task_blocked",
      conditionsJson: JSON.stringify({ department: "engineering" }),
      action: "escalate_to_manager",
      actionConfigJson: JSON.stringify({ message: "Task blocked" }),
      sourceDepartment: "engineering",
      targetDepartment: "executive",
      priority: 80,
      status: "active",
    });

    expect(ruleId).toBeTruthy();

    // Rule appears in snapshot
    const snapshot = shared.db.projection.snapshot.listSnapshot();
    const rule = snapshot.automationRules.find(r => r.id === ruleId);
    expect(rule).toBeTruthy();
    expect(rule!.name).toBe("Auto-escalate blocked tasks");
    expect(rule!.trigger).toBe("task_blocked");
    expect(rule!.action).toBe("escalate_to_manager");
    expect(rule!.status).toBe("active");
    expect(rule!.priority).toBe(80);
    expect(rule!.executionCount).toBe(0);

    // Toggle to paused
    shared.db.automation.rules.toggleAutomationRule(ruleId, shared.companyId, "paused");
    const updated = shared.db.projection.snapshot.listSnapshot().automationRules.find(r => r.id === ruleId);
    expect(updated!.status).toBe("paused");

    // Record execution
    shared.db.automation.rules.recordAutomationExecution(ruleId, shared.companyId, "Auto-escalate blocked tasks", "task_blocked", "escalate_to_manager", "Escalated task-123");
    const afterExec = shared.db.projection.snapshot.listSnapshot().automationRules.find(r => r.id === ruleId);
    expect(afterExec!.executionCount).toBe(1);
    expect(afterExec!.lastExecutedAt).toBeTruthy();

    // Automation log
    const log = shared.db.automation.rules.getAutomationLog(shared.companyId);
    expect(log).toHaveLength(1);
    expect(log[0].ruleName).toBe("Auto-escalate blocked tasks");

    // Delete
    shared.db.automation.rules.deleteAutomationRule(ruleId, shared.companyId);
    const afterDelete = shared.db.projection.snapshot.listSnapshot().automationRules.find(r => r.id === ruleId);
    expect(afterDelete).toBeUndefined();
  });

  it("updates an existing rule", () => {
    const ruleId = shared.db.automation.rules.saveAutomationRule({
      companyId: shared.companyId,
      name: "Original name",
      trigger: "task_created",
      action: "assign_task",
    });

    shared.db.automation.rules.saveAutomationRule({
      id: ruleId,
      companyId: shared.companyId,
      name: "Updated name",
      trigger: "task_created",
      action: "notify_agent",
      priority: 90,
    });

    const rule = shared.db.projection.snapshot.listSnapshot().automationRules.find(r => r.id === ruleId);
    expect(rule!.name).toBe("Updated name");
    expect(rule!.action).toBe("notify_agent");
    expect(rule!.priority).toBe(90);
  });
});

describe("Agent Messages", () => {
  let agentAId: string;
  let agentBId: string;

  beforeEach(() => {
    agentAId = shared.db.core.agents.saveAgent({
      companyId: shared.companyId, name: "Alice", role: "Engineer", title: "Senior Engineer",
      department: "engineering", connectorId: "claude-pro", status: "active",
      capabilities: "Backend development, API design, code review",
      budgetMonthlyUsd: 100,
    });
    agentBId = shared.db.core.agents.saveAgent({
      companyId: shared.companyId, name: "Bob", role: "Designer", title: "UX Designer",
      department: "design", connectorId: "claude-pro", status: "active",
      capabilities: "UI design, wireframing, user research",
      budgetMonthlyUsd: 100,
    });
  });

  it("sends and retrieves direct messages", () => {
    const msgId = shared.db.core.messages.sendAgentMessage({
      companyId: shared.companyId,
      fromAgentId: agentAId,
      toAgentId: agentBId,
      channel: "direct",
      subject: "Need design review",
      body: "Can you review the login page mockup?",
      priority: "normal",
    });

    expect(msgId).toBeTruthy();

    const messages = shared.db.core.messages.listAgentMessages(shared.companyId);
    expect(messages).toHaveLength(1);
    expect(messages[0].subject).toBe("Need design review");
    expect(messages[0].fromAgentId).toBe(agentAId);
    expect(messages[0].toAgentId).toBe(agentBId);
    expect(messages[0].readAt).toBeNull();
  });

  it("marks messages as read", () => {
    const msgId = shared.db.core.messages.sendAgentMessage({
      companyId: shared.companyId,
      fromAgentId: agentAId,
      toAgentId: agentBId,
      subject: "Test",
      body: "Hello",
    });

    shared.db.core.messages.markMessageReadForReader(msgId, shared.companyId);
    const messages = shared.db.core.messages.listAgentMessages(shared.companyId);
    const updatedMessage = messages.find((message) => message.id === msgId);
    expect(updatedMessage?.readAt).toBeTruthy();
  });

  it("tracks read state per agent without marking the sender unread", () => {
    const msgId = shared.db.core.messages.sendAgentMessage({
      companyId: shared.companyId,
      fromAgentId: agentAId,
      toAgentId: agentBId,
      subject: "Test",
      body: "Hello",
    });

    const senderView = shared.db.core.messages.listAgentMessages(shared.companyId, { agentId: agentAId });
    expect(senderView).toHaveLength(1);
    expect(senderView[0].id).toBe(msgId);
    expect(senderView[0].readAt).toBeTruthy();

    const recipientViewBefore = shared.db.core.messages.listAgentMessages(shared.companyId, { agentId: agentBId, unreadOnly: true });
    expect(recipientViewBefore).toHaveLength(1);
    expect(recipientViewBefore[0].id).toBe(msgId);

    shared.db.core.messages.markMessageReadForReader(msgId, shared.companyId, agentBId);

    const recipientViewAfter = shared.db.core.messages.listAgentMessages(shared.companyId, { agentId: agentBId, unreadOnly: true });
    expect(recipientViewAfter).toHaveLength(0);

    const thirdAgentId = createAgent({ name: "Agent C" });
    const thirdView = shared.db.core.messages.listAgentMessages(shared.companyId, { agentId: thirdAgentId });
    expect(thirdView).toHaveLength(0);
  });

  it("limits department and project messages to relevant members", () => {
    const engineeringLeadId = createAgent({ name: "Engineering Lead", role: "Lead", department: "engineering" });
    const productLeadId = createAgent({ name: "Product Lead", role: "Lead", department: "product" });

    const projectId = shared.db.core.entity.saveProject({
      companyId: shared.companyId,
      name: "Cross-team Project",
      description: "Scope",
      leadAgentId: engineeringLeadId,
      status: "active",
    });
    shared.db.core.tasks.saveTask({
      companyId: shared.companyId,
      title: "Project task",
      description: "Do work",
      assigneeAgentId: engineeringLeadId,
      projectId,
      status: "todo",
      priority: "medium",
    });

    const deptMessageId = shared.db.core.messages.sendAgentMessage({
      companyId: shared.companyId,
      fromAgentId: engineeringLeadId,
      channel: "department",
      channelTargetId: "engineering",
      subject: "Engineering update",
      body: "Only engineering should see this",
    });
    const projectMessageId = shared.db.core.messages.sendAgentMessage({
      companyId: shared.companyId,
      fromAgentId: engineeringLeadId,
      channel: "project",
      channelTargetId: projectId,
      subject: "Project update",
      body: "Only project members should see this",
    });

    const engineeringView = shared.db.core.messages.listAgentMessages(shared.companyId, { agentId: engineeringLeadId });
    expect(engineeringView.some((message) => message.id === deptMessageId)).toBe(true);
    expect(engineeringView.some((message) => message.id === projectMessageId)).toBe(true);

    const productView = shared.db.core.messages.listAgentMessages(shared.companyId, { agentId: productLeadId });
    expect(productView.some((message) => message.id === deptMessageId)).toBe(false);
    expect(productView.some((message) => message.id === projectMessageId)).toBe(false);
  });

  it("filters messages by channel", () => {
    shared.db.core.messages.sendAgentMessage({ companyId: shared.companyId, fromAgentId: agentAId, subject: "Dept update", body: "All good", channel: "department", channelTargetId: "engineering" });
    shared.db.core.messages.sendAgentMessage({ companyId: shared.companyId, fromAgentId: agentAId, toAgentId: agentBId, subject: "DM", body: "Hey", channel: "direct" });

    const deptMsgs = shared.db.core.messages.listAgentMessages(shared.companyId, { channel: "department" });
    expect(deptMsgs).toHaveLength(1);
    expect(deptMsgs[0].subject).toBe("Dept update");

    const directMsgs = shared.db.core.messages.listAgentMessages(shared.companyId, { channel: "direct" });
    expect(directMsgs).toHaveLength(1);
    expect(directMsgs[0].subject).toBe("DM");
  });

  it("appears in snapshot", () => {
    shared.db.core.messages.sendAgentMessage({ companyId: shared.companyId, fromAgentId: agentAId, channel: "company", subject: "Snapshot test", body: "Hi" });
    const snapshot = shared.db.projection.snapshot.listSnapshot();
    expect(snapshot.agentMessages.length).toBeGreaterThanOrEqual(1);
    expect(snapshot.agentMessages[0].subject).toBe("Snapshot test");
  });
});

describe("Auto Task Assignment", () => {
  let backendId: string;
  let frontendId: string;

  beforeEach(() => {
    backendId = shared.db.core.agents.saveAgent({
      companyId: shared.companyId, name: "Backend Dev", role: "Backend Engineer", title: "Senior Backend",
      department: "engineering", connectorId: "openai-codex", status: "active",
      capabilities: "API development, database design, Node.js, PostgreSQL, backend testing",
      budgetMonthlyUsd: 200,
    });
    frontendId = shared.db.core.agents.saveAgent({
      companyId: shared.companyId, name: "Frontend Dev", role: "Frontend Engineer", title: "Senior Frontend",
      department: "engineering", connectorId: "openai-codex", status: "active",
      capabilities: "React, TypeScript, CSS, Tailwind, responsive design, frontend testing, UI components",
      budgetMonthlyUsd: 200,
    });
  });

  it("assigns to the best-matching agent by capability keywords", () => {
    const taskId = shared.db.core.tasks.saveTask({
      companyId: shared.companyId, title: "Build React component for user dashboard",
      description: "Create a responsive React component with Tailwind CSS styling",
      priority: "medium", status: "todo",
    });

    const assignedId = shared.db.core.tasks.autoAssignTask(taskId, shared.companyId);
    expect(assignedId).toBe(frontendId); // "React", "responsive", "Tailwind" match frontend
  });

  it("assigns backend task to backend agent", () => {
    const taskId = shared.db.core.tasks.saveTask({
      companyId: shared.companyId, title: "Design database schema for orders",
      description: "PostgreSQL database design with API endpoints for order management",
      priority: "high", status: "todo",
    });

    const assignedId = shared.db.core.tasks.autoAssignTask(taskId, shared.companyId);
    expect(assignedId).toBe(backendId); // "database", "PostgreSQL", "API" match backend
  });

  it("returns existing assignee if task already assigned", () => {
    const taskId = shared.db.core.tasks.saveTask({
      companyId: shared.companyId, title: "Already assigned task",
      description: "This task has an assignee",
      assigneeAgentId: frontendId,
      priority: "medium", status: "todo",
    });

    const result = shared.db.core.tasks.autoAssignTask(taskId, shared.companyId);
    expect(result).toBe(frontendId);
  });

  it("returns null if all agents have exhausted their budget", () => {
    // Set positive budgets that are fully spent
    shared.db.core.agents.saveAgent({ id: backendId, companyId: shared.companyId, name: "Backend Dev", role: "Backend", title: "Backend", connectorId: "openai-codex", status: "active", capabilities: "backend", budgetMonthlyUsd: 100 });
    shared.db.core.agents.saveAgent({ id: frontendId, companyId: shared.companyId, name: "Frontend Dev", role: "Frontend", title: "Frontend", connectorId: "openai-codex", status: "active", capabilities: "frontend", budgetMonthlyUsd: 100 });
    // Exhaust budgets by recording spending via direct SQL (since finishRun would need a real run)
    (shared.db as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).db.prepare("update agents set spent_monthly_usd = 100 where id = ?").run(backendId);
    (shared.db as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).db.prepare("update agents set spent_monthly_usd = 100 where id = ?").run(frontendId);

    const taskId = shared.db.core.tasks.saveTask({ companyId: shared.companyId, title: "No budget task", description: "Test", priority: "low", status: "todo" });
    const result = shared.db.core.tasks.autoAssignTask(taskId, shared.companyId);
    expect(result).toBeNull();
  });

  it("penalizes agents with many active tasks", () => {
    // Give backend agent 5 active tasks
    for (let i = 0; i < 5; i++) {
      shared.db.core.tasks.saveTask({ companyId: shared.companyId, title: `Backend task ${i}`, description: "", assigneeAgentId: backendId, priority: "medium", status: "in_progress" });
    }

    // Generic task with no strong keyword match — should go to less busy frontend agent
    const taskId = shared.db.core.tasks.saveTask({ companyId: shared.companyId, title: "Implement feature", description: "Build the feature", priority: "medium", status: "todo" });
    const assignedId = shared.db.core.tasks.autoAssignTask(taskId, shared.companyId);
    expect(assignedId).toBe(frontendId); // Frontend has 0 active tasks vs backend's 5
  });
});

describe("Workflow Pipelines", () => {
  it("creates, activates, and deletes a workflow", () => {
    const wfId = shared.db.automation.rules.saveWorkflow({
      companyId: shared.companyId,
      name: "Code Review Pipeline",
      description: "Auto-review flow for PRs",
      triggerType: "task_status_changed",
      triggerConfigJson: JSON.stringify({ toStatus: "in_review" }),
      stepsJson: JSON.stringify([
        { id: "s1", name: "Run tests", action: "run_task", status: "pending" },
        { id: "s2", name: "Notify reviewer", action: "notify_agent", status: "pending" },
      ]),
      status: "draft",
    });

    expect(wfId).toBeTruthy();
    const snapshot = shared.db.projection.snapshot.listSnapshot();
    const wf = snapshot.workflows.find(w => w.id === wfId);
    expect(wf!.name).toBe("Code Review Pipeline");
    expect(wf!.status).toBe("draft");
    expect(wf!.runCount).toBe(0);

    // Delete
    shared.db.automation.rules.deleteWorkflow(wfId, shared.companyId);
    expect(shared.db.projection.snapshot.listSnapshot().workflows.find(w => w.id === wfId)).toBeUndefined();
  });
});
