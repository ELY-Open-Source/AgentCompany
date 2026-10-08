import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

const requested: string[] = [];
const written: string[] = [];
const pages = new Map<string, Record<string, unknown>>();

vi.mock("electron", () => ({
  net: {
    request: ({ url }: { url: string }) => {
      const request = new EventEmitter() as EventEmitter & { setHeader: () => void; write: (body: string) => void; end: () => void; abort: () => void };
      request.setHeader = () => undefined;
      request.write = (body: string) => { written.push(`${url} ${body}`); };
      request.abort = () => undefined;
      request.end = () => {
        requested.push(url);
        const query = new URL(url).searchParams;
        const page = url.includes("/tools/execute/") ? { data: { number: 42 }, successful: true } : pages.get(`${query.get("toolkit_slug")}:${query.get("cursor") ?? ""}`);
        const response = new EventEmitter() as EventEmitter & { statusCode: number };
        response.statusCode = page ? 200 : 404;
        request.emit("response", response);
        response.emit("data", Buffer.from(JSON.stringify(page ?? { error: "no such page" })));
        response.emit("end");
      };
      return request;
    },
  },
}));

const { ComposioClient } = await import("../../src/main/services/composio/composio-client");
const { executeComposioTool, loadComposioTools } = await import("../../src/main/services/composio/composio-tool-bridge");
const { DatabaseConnection } = await import("../../src/main/database/connection");
const { OrganizationService } = await import("../../src/main/services/organization-service");
const { IntegrationKeyStore } = await import("../../src/main/services/integration-key-store");
const { ConnectorGrantsService } = await import("../../src/main/services/composio/connector-grants");
const { recordRunAction } = await import("../../src/main/services/run-journal");

const tool = (slug: string) => ({ slug, name: slug, description: "", input_parameters: {}, toolkit: { slug: "github" } });

describe("a toolkit's tools are all listed", () => {
  test("every page of a toolkit's tools is read, not just the first twenty", async () => {
    const first = Array.from({ length: 100 }, (_, index) => tool(`GITHUB_A${index}`));
    pages.set("github:", { items: first, next_cursor: "page2", total_items: 101 });
    pages.set("github:page2", { items: [tool("GITHUB_CREATE_PULL_REQUEST")], next_cursor: null, total_items: 101 });
    pages.set("slack:", { items: [tool("SLACK_SEND_MESSAGE")], next_cursor: null, total_items: 1 });
    const tools = await new ComposioClient("ak_test").getTools(["github", "slack"]);
    expect(tools).toHaveLength(102);
    expect(tools.map((schema) => schema.name)).toContain("GITHUB_CREATE_PULL_REQUEST");
    expect(requested.map((url) => new URL(url).searchParams.get("limit"))).toEqual(["100", "100", "100"]);
  });
});

describe("agents reach every action through search and run", () => {
  const vault = { encryptSecret: (secret: string) => Buffer.from(secret, "utf8"), decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8") };

  function company(apiKey = "ak_actions") {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-actions-${randomUUID()}.db`));
    let orgId = "";
    let ceoId = "";
    connection.transaction(() => {
      orgId = new OrganizationService(connection.db).createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
      const providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      ceoId = new OrganizationService(connection.db).createAgent({ orgId, name: "CEO", role: "CEO", department: "Executive", modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 1000, managerAgentId: null, roleLevel: "c_suite" });
      const now = new Date().toISOString();
      connection.db.prepare("insert into connector_accounts(id, org_id, toolkit_slug, toolkit_name, auth_config_id, status, created_at, updated_at) values ('ca_gh', ?, 'github', 'GitHub', 'ac_gh', 'ACTIVE', ?, ?)").run(orgId, now, now);
    });
    const keys = new IntegrationKeyStore(connection.db, vault);
    keys.write("composio", apiKey);
    const call = (name: string, args: Record<string, unknown>) => executeComposioTool(connection.db, keys, orgId, ceoId, { id: "c1", name, arguments: args });
    return { connection, keys, orgId, ceoId, call };
  }

  test("the agent carries a search and a runner, not a slice of the list", () => {
    const h = company();
    expect(loadComposioTools(h.connection.db, h.keys, h.orgId, h.ceoId).map((tool) => tool.name)).toEqual(["composio_find_actions", "composio_run_action"]);
    h.connection.close();
  });

  test("an action past the first page is found with its input and runs on the connected account", async () => {
    pages.set("github:", { items: Array.from({ length: 100 }, (_, index) => tool(`GITHUB_LIST_THING_${index}`)), next_cursor: "page2" });
    pages.set("github:page2", { items: [{ ...tool("GITHUB_CREATE_A_PULL_REQUEST"), description: "Create a pull request", input_parameters: { properties: { title: { type: "string" } }, required: ["title"] } }], next_cursor: null });
    const h = company();
    const found = JSON.parse(await h.call("composio_find_actions", { query: "create pull request" })) as { matches: Array<{ action: string; input: unknown }>; searched: number };
    expect(found.searched).toBe(101);
    expect(found.matches[0]).toMatchObject({ action: "GITHUB_CREATE_A_PULL_REQUEST", input: { properties: { title: { type: "string" } }, required: ["title"] } });
    expect(await h.call("composio_run_action", { action: "GITHUB_CREATE_A_PULL_REQUEST", arguments: { title: "Fix" } })).toBe(JSON.stringify({ data: { number: 42 }, successful: true }));
    expect(written.at(-1)).toContain("/tools/execute/GITHUB_CREATE_A_PULL_REQUEST");
    expect(written.at(-1)).toContain("\"connected_account_id\":\"ca_gh\"");
    expect(await h.call("composio_run_action", { action: "SLACK_SEND_MESSAGE", arguments: {} })).toContain("is not an action of your connected services (github)");
    h.connection.close();
  });

  test("a grant revoked while the catalog loads stops the action, and a search is not journaled as work", async () => {
    pages.set("github:", { items: [tool("GITHUB_STAR_A_REPOSITORY")], next_cursor: null });
    const h = company("ak_revoke");
    const staff = h.connection.transaction(() => {
      const providerId = (h.connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(h.orgId) as { id: string }).id;
      const id = new OrganizationService(h.connection.db).createAgent({ orgId: h.orgId, name: "Ada", role: "Engineer", department: "Engineering", modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 1000, managerAgentId: h.ceoId });
      new ConnectorGrantsService(h.connection.db).grant({ orgId: h.orgId, agentId: id, toolkitSlug: "github", grantedByType: "agent", grantedById: h.ceoId });
      return id;
    });
    const running = executeComposioTool(h.connection.db, h.keys, h.orgId, staff, { id: "c2", name: "composio_run_action", arguments: { action: "GITHUB_STAR_A_REPOSITORY", arguments: {} } });
    new ConnectorGrantsService(h.connection.db).revoke({ orgId: h.orgId, agentId: staff, toolkitSlug: "github" });
    expect(await running).toContain('You have no grant for the "github" connector');
    recordRunAction(h.connection.db, { orgId: h.orgId, runId: "run_x", taskId: "task_x", call: { id: "c3", name: "composio_find_actions", arguments: { query: "star" } }, output: "{}" });
    expect(h.connection.db.prepare("select count(*) as n from run_actions").get()).toEqual({ n: 0 });
    h.connection.close();
  });
});
