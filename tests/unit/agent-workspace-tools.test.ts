import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { dispatchAgentTool, type AgentToolContext } from "../../src/main/services/agent-tools";
import { executeWorkspaceTool, isWorkspaceTool, WORKSPACE_TOOLS } from "../../src/main/services/agent-workspace-tools";
import type { ToolCall } from "../../src/main/services/provider-tool-turn";

const workspaceRoot = join(tmpdir(), `ac-workspace-tools-${randomUUID()}`);
mkdirSync(join(workspaceRoot, "src"), { recursive: true });
mkdirSync(join(workspaceRoot, "node_modules", "left-pad"), { recursive: true });
writeFileSync(join(workspaceRoot, "README.md"), "# Demo\n");
writeFileSync(join(workspaceRoot, "src", "index.ts"), "export const answer = 42;\n");
writeFileSync(join(workspaceRoot, "node_modules", "left-pad", "index.js"), "module.exports = () => {};\n");

afterAll(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: `call_${randomUUID()}`, name, arguments: args };
}

function ctx(writeAccess: boolean): AgentToolContext {
  return {
    orgId: "org_test",
    agent: { id: "agt_test", modelProviderId: null, modelId: null },
    taskProjectId: null,
    taskGoalId: null,
    workspace: { id: "wsp_test", localPath: workspaceRoot, writeAccess },
  };
}

describe("agent workspace tools", () => {
  test("registers the three tools and recognises them by name", () => {
    expect(WORKSPACE_TOOLS.map((tool) => tool.name)).toEqual(["list_files", "read_file", "run_command"]);
    expect(isWorkspaceTool("run_command")).toBe(true);
    expect(isWorkspaceTool("write_deliverable")).toBe(false);
  });

  test("list_files walks the workspace and skips dependency folders", async () => {
    const listing = await executeWorkspaceTool(ctx(false), call("list_files", {}));
    expect(listing).toContain("README.md");
    expect(listing).toContain("src/index.ts");
    expect(listing).not.toContain("left-pad");
  });

  test("read_file returns contents and refuses to leave the workspace", async () => {
    expect(await executeWorkspaceTool(ctx(false), call("read_file", { path: "src/index.ts" }))).toContain("answer = 42");
    expect(await executeWorkspaceTool(ctx(false), call("read_file", { path: "../outside.txt" }))).toContain("ERROR");
    expect(await executeWorkspaceTool(ctx(false), call("read_file", { path: "C:/Windows/win.ini" }))).toContain("ERROR");
  });

  test("run_command is gated on the task's approved filesystem access", async () => {
    const denied = await executeWorkspaceTool(ctx(false), call("run_command", { command: "echo blocked" }));
    expect(denied).toContain("ERROR");
    expect(denied).toContain("filesystem access");

    const allowed = await executeWorkspaceTool(ctx(true), call("run_command", { command: "echo it works" }));
    expect(allowed).toContain("exit code 0");
    expect(allowed).toContain("it works");

    const failing = await executeWorkspaceTool(ctx(true), call("run_command", { command: 'node -e "process.exit(3)"' }));
    expect(failing).toContain("exit code 3");
  });

  test("tools without a bound workspace explain the situation instead of crashing", async () => {
    const noWorkspace: AgentToolContext = { ...ctx(true), workspace: null };
    expect(await executeWorkspaceTool(noWorkspace, call("list_files", {}))).toContain("No workspace");
  });

  test("create_task can request filesystem access, which lands as an approval-gated task", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-fs-task-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    let orgId = "";
    let ceoId = "";
    let providerId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "BuildCorp", employeeName: "Yang", mission: "m", goal: "g", executionMode: "ai_cofounder" });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      connection.db.prepare("update providers set enabled = 1 where id = ?").run(providerId);
      ceoId = organization.createAgent({
        orgId, name: "CEO", role: "CEO", department: "Executive",
        modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 25000, managerAgentId: null,
      });
    });
    const deps = { db: connection.db, organization, chat: new ChatService(connection.db) };
    const toolCtx: AgentToolContext = {
      orgId, agent: { id: ceoId, modelProviderId: providerId, modelId: "gpt-5.4" },
      taskProjectId: null, taskGoalId: null, workspace: null,
    };

    const result = dispatchAgentTool(deps, toolCtx, call("create_task", {
      title: "Implement tenant RBAC",
      description: "Build and test the tenant RBAC module.",
      requires_filesystem: true,
    }));
    const taskId = /task_id=(\S+?)\)/.exec(result)?.[1] ?? "";
    expect(taskId).toBeTruthy();

    const task = connection.db.prepare("select requires_filesystem from tasks where id = ?").get(taskId) as { requires_filesystem: number };
    expect(task.requires_filesystem).toBe(1);
    const approval = connection.db.prepare(
      "select state from approvals where org_id = ? and source_entity_type = 'task' and source_entity_id = ?",
    ).get(orgId, taskId) as { state: string } | undefined;
    expect(approval).toMatchObject({ state: "pending" });
    connection.close();
  });
});
