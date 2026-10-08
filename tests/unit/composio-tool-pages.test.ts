import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

const requested: string[] = [];
const written: string[] = [];
const pages = new Map<string, Record<string, unknown>>();
const executions = new Map<string, Record<string, unknown>>();
const aborted: string[] = [];

vi.mock("electron", () => ({
  net: {
    request: ({ url }: { url: string }) => {
      const request = new EventEmitter() as EventEmitter & { setHeader: () => void; write: (body: string) => void; end: () => void; abort: () => void };
      request.setHeader = () => undefined;
      request.write = (body: string) => { written.push(`${url} ${body}`); };
      request.abort = () => { aborted.push(url); };
      request.end = () => {
        requested.push(url);
        if (url.includes("/tools/execute/GITHUB_HANG")) return;
        if (url.includes("/tools/execute/GITHUB_DROP")) {
          request.emit("error", new Error("socket hang up"));
          return;
        }
        const query = new URL(url).searchParams;
        const page = url.includes("/tools/execute/") ? executions.get(url.split("/tools/execute/")[1]) ?? { data: { number: 42 }, error: null, successful: true } : pages.get(`${query.get("toolkit_slug")}:${query.get("cursor") ?? ""}`);
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
const { canonicalJson } = await import("../../src/main/services/composio/connector-executions");

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

describe("a Composio call that never answers", () => {
  test("is given up after its time limit and its request is aborted", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const pending = new ComposioClient("ak_hang").executeTool({ toolName: "GITHUB_HANG", arguments: {}, userId: "u" });
      const outcome = pending.then(() => "answered", (error: Error) => error.message);
      await vi.advanceTimersByTimeAsync(119_000);
      expect(aborted.some((url) => url.includes("GITHUB_HANG"))).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await outcome).toBe("Composio API POST https://backend.composio.dev/api/v3/tools/execute/GITHUB_HANG gave no answer within 120s.");
      expect(aborted.some((url) => url.includes("GITHUB_HANG"))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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
      connection.db.prepare("insert into connector_accounts(id, org_id, toolkit_slug, toolkit_name, label, auth_config_id, status, created_at, updated_at) values ('ca_gh', ?, 'github', 'GitHub', 'main', 'ac_gh', 'ACTIVE', ?, ?)").run(orgId, now, now);
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
    expect(await h.call("composio_run_action", { action: "GITHUB_CREATE_A_PULL_REQUEST", arguments: { title: "Fix" } })).toBe(JSON.stringify({ number: 42 }));
    expect(written.at(-1)).toContain("/tools/execute/GITHUB_CREATE_A_PULL_REQUEST");
    expect(written.at(-1)).toContain("\"connected_account_id\":\"ca_gh\"");
    expect(await h.call("composio_run_action", { action: "SLACK_SEND_MESSAGE", arguments: {} })).toContain("is not an action of your connected services (github)");
    h.connection.close();
  });

  test("an action Composio reports as failed, or without a status, is a failed call", async () => {
    pages.set("github:", { items: [tool("GITHUB_MERGE"), tool("GITHUB_ODD")], next_cursor: null });
    executions.set("GITHUB_MERGE", { data: { message: "Not Found" }, error: "Repository not found", successful: false });
    executions.set("GITHUB_ODD", { data: { ok: 1 } });
    const h = company("ak_failed");
    expect(await h.call("composio_run_action", { action: "GITHUB_MERGE", arguments: {} })).toBe("ERROR: GITHUB_MERGE failed: Repository not found");
    expect(await h.call("composio_run_action", { action: "GITHUB_ODD", arguments: {} })).toBe("ERROR: GITHUB_ODD may or may not have run; its reply was lost (Composio returned no execution status for GITHUB_ODD). Check in github whether it took effect before calling it again.");
    h.connection.close();
  });

  test("a call whose reply was lost is not repeated until the agent confirms it did not happen", async () => {
    pages.set("github:", { items: [tool("GITHUB_DROP"), tool("GITHUB_MERGE")], next_cursor: null });
    executions.set("GITHUB_MERGE", { data: {}, error: "Repository not found", successful: false });
    const h = company("ak_lost");
    const lost = await h.call("composio_run_action", { action: "GITHUB_DROP", arguments: { body: "hi", to: "a" } });
    expect(lost).toBe("ERROR: GITHUB_DROP may or may not have run; its reply was lost (socket hang up). Check in github whether it took effect before calling it again.");
    const sent = written.length;
    const again = await h.call("composio_run_action", { action: "GITHUB_DROP", arguments: { to: "a", body: "hi" } });
    expect(again).toMatch(/^ERROR: An identical GITHUB_DROP call at .+ may already have run; its reply was lost: socket hang up\. Check in github whether it took effect\. If it did not, call again with confirm_not_done: true\.$/);
    expect(written.length).toBe(sent);
    expect(await h.call("composio_run_action", { action: "GITHUB_DROP", arguments: { to: "a", body: "hi" }, confirm_not_done: "true" })).toBe("ERROR: confirm_not_done must be true or false.");
    expect(written.length).toBe(sent);
    expect(await h.call("composio_run_action", { action: "GITHUB_DROP", arguments: { to: "b", body: "hi" } })).toContain("may or may not have run");
    expect(await h.call("composio_run_action", { action: "GITHUB_DROP", arguments: { to: "a", body: "hi" }, confirm_not_done: true })).toContain("may or may not have run");
    expect(written.length).toBe(sent + 2);
    // A definite failure does not block the same call again.
    expect(await h.call("composio_run_action", { action: "GITHUB_MERGE", arguments: {} })).toBe("ERROR: GITHUB_MERGE failed: Repository not found");
    expect(await h.call("composio_run_action", { action: "GITHUB_MERGE", arguments: {} })).toBe("ERROR: GITHUB_MERGE failed: Repository not found");
    const states = h.connection.db.prepare("select action, state from connector_executions order by rowid").all() as Array<{ action: string; state: string }>;
    expect(states.map((row) => `${row.action}:${row.state}`)).toEqual(["GITHUB_DROP:resolved", "GITHUB_DROP:unknown", "GITHUB_DROP:unknown", "GITHUB_MERGE:failed", "GITHUB_MERGE:failed"]);
    h.connection.close();
  });

  test("a call left pending by a crash blocks the same call", async () => {
    pages.set("github:", { items: [tool("GITHUB_SEND")], next_cursor: null });
    const h = company("ak_crash");
    // A row as written before accounts had labels: no account_label, a hash of the arguments alone.
    const now = new Date().toISOString();
    h.connection.db.prepare("insert into connector_executions(id, org_id, agent_id, action, arguments_hash, state, created_at, updated_at) values ('cex_old', ?, ?, 'GITHUB_SEND', ?, 'pending', ?, ?)")
      .run(h.orgId, h.ceoId, createHash("sha256").update(canonicalJson({ text: "x" })).digest("hex"), now, now);
    expect(await h.call("composio_run_action", { action: "GITHUB_SEND", arguments: { text: "x" } })).toMatch(/^ERROR: An identical GITHUB_SEND call at .+ may already have run; its reply was lost\. Check in github/);
    h.connection.close();
  });

  test("an agent that reaches several accounts of a service names the one an action runs on", async () => {
    pages.set("github:", { items: [tool("GITHUB_STAR"), tool("GITHUB_DROP")], next_cursor: null });
    const h = company("ak_accounts");
    const now = new Date().toISOString();
    h.connection.db.prepare("insert into connector_accounts(id, org_id, toolkit_slug, toolkit_name, label, auth_config_id, status, created_at, updated_at) values ('ca_gh_sales', ?, 'github', 'GitHub', 'sales', 'ac_gh', 'ACTIVE', ?, ?)").run(h.orgId, now, now);
    expect(await h.call("composio_run_action", { action: "GITHUB_STAR", arguments: {} })).toBe('ERROR: "github" has several accounts (main, sales); name one with account.');
    expect(await h.call("composio_run_action", { action: "GITHUB_STAR", arguments: {}, account: "sales" })).toBe(JSON.stringify({ number: 42 }));
    expect(written.at(-1)).toContain("\"connected_account_id\":\"ca_gh_sales\"");
    expect(await h.call("composio_run_action", { action: "GITHUB_DROP", arguments: {}, account: "main" })).toContain("may or may not have run");
    expect(await h.call("composio_run_action", { action: "GITHUB_DROP", arguments: {}, account: "sales" })).toContain("may or may not have run");
    h.connection.close();
  });

  test("a grant limited to some actions and one resource shows and runs only those", async () => {
    const withRepo = (slug: string, description: string) => ({ slug, name: slug, description, input_parameters: { type: "object", properties: { repo: { type: "string" } } }, toolkit: { slug: "github" } });
    pages.set("github:", { items: [withRepo("GITHUB_LIST_ISSUES", "list issues"), withRepo("GITHUB_CREATE_ISSUE", "create issue"), tool("GITHUB_LIST_ALL_REPOS")], next_cursor: null });
    const h = company("ak_limits");
    const staff = h.connection.transaction(() => {
      const providerId = (h.connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(h.orgId) as { id: string }).id;
      const id = new OrganizationService(h.connection.db).createAgent({ orgId: h.orgId, name: "Ada", role: "Engineer", department: "Engineering", modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 1000, managerAgentId: h.ceoId });
      new ConnectorGrantsService(h.connection.db).grant({ orgId: h.orgId, agentId: id, toolkitSlug: "github", accountLabel: null, limits: { actions: ["github_list_issues", "GITHUB_LIST_ALL_REPOS"], fixedArguments: { repo: "site" } }, grantedByType: "agent", grantedById: h.ceoId });
      return id;
    });
    const asAda = (name: string, args: Record<string, unknown>) => executeComposioTool(h.connection.db, h.keys, h.orgId, staff, { id: "c9", name, arguments: args });
    const found = JSON.parse(await asAda("composio_find_actions", { query: "issue" })) as { matches: Array<{ action: string }> };
    expect(found.matches.map((match) => match.action)).toEqual(["GITHUB_LIST_ISSUES"]);
    expect(await asAda("composio_run_action", { action: "GITHUB_CREATE_ISSUE", arguments: { repo: "site" } }))
      .toBe("ERROR: Your grant for github allows only GITHUB_LIST_ISSUES, GITHUB_LIST_ALL_REPOS; GITHUB_CREATE_ISSUE is not among them.");
    expect(await asAda("composio_run_action", { action: "GITHUB_LIST_ISSUES", arguments: { repo: "secret" } }))
      .toBe('ERROR: Your grant for github is limited to repo="site"; this call has repo="secret".');
    expect(await asAda("composio_run_action", { action: "GITHUB_LIST_ISSUES", arguments: {} }))
      .toBe('ERROR: Your grant for github is limited to repo="site"; pass repo with that value.');
    expect(await asAda("composio_run_action", { action: "GITHUB_LIST_ALL_REPOS", arguments: {} }))
      .toBe('ERROR: Your grant for github is limited to repo="site", and GITHUB_LIST_ALL_REPOS takes no repo.');
    const sent = written.length;
    expect(await asAda("composio_run_action", { action: "GITHUB_LIST_ISSUES", arguments: { repo: "site" } })).toBe(JSON.stringify({ number: 42 }));
    expect(written.length).toBe(sent + 1);
    // The CEO holds every action by role.
    expect(await h.call("composio_run_action", { action: "GITHUB_CREATE_ISSUE", arguments: { repo: "other" } })).toBe(JSON.stringify({ number: 42 }));
    h.connection.close();
  });

  test("a grant revoked while the catalog loads stops the action, and a search is not journaled as work", async () => {
    pages.set("github:", { items: [tool("GITHUB_STAR_A_REPOSITORY")], next_cursor: null });
    const h = company("ak_revoke");
    const staff = h.connection.transaction(() => {
      const providerId = (h.connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(h.orgId) as { id: string }).id;
      const id = new OrganizationService(h.connection.db).createAgent({ orgId: h.orgId, name: "Ada", role: "Engineer", department: "Engineering", modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 1000, managerAgentId: h.ceoId });
      new ConnectorGrantsService(h.connection.db).grant({ orgId: h.orgId, agentId: id, toolkitSlug: "github", accountLabel: null, limits: { actions: null, fixedArguments: null }, grantedByType: "agent", grantedById: h.ceoId });
      return id;
    });
    const running = executeComposioTool(h.connection.db, h.keys, h.orgId, staff, { id: "c2", name: "composio_run_action", arguments: { action: "GITHUB_STAR_A_REPOSITORY", arguments: {} } });
    new ConnectorGrantsService(h.connection.db).revoke({ orgId: h.orgId, agentId: staff, toolkitSlug: "github" });
    expect(await running).toContain('You have no grant for the "github" connector');
    recordRunAction(h.connection.db, { orgId: h.orgId, runId: "run_x", taskId: "task_x", call: { id: "c3", name: "composio_find_actions", arguments: { query: "star" } }, output: "{}" });
    expect(h.connection.db.prepare("select count(*) as n from run_actions").get()).toEqual({ n: 0 });
    h.connection.close();
  });

  test("an action's input schema reaches the agent whole: references, combinations and limits included", async () => {
    const input = {
      type: "object",
      $defs: { Reviewer: { type: "object", properties: { login: { type: "string" } }, required: ["login"] } },
      properties: {
        title: { type: "string", maxLength: 256 },
        reviewers: { type: "array", items: { $ref: "#/$defs/Reviewer" } },
        base: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
      required: ["title"],
      additionalProperties: false,
      oneOf: [{ required: ["base"] }, { required: ["reviewers"] }],
    };
    pages.set("github:", { items: [{ ...tool("GITHUB_CREATE_A_PULL_REQUEST"), description: "Create a pull request", input_parameters: input }], next_cursor: null });
    const h = company("ak_schema");
    const found = JSON.parse(await h.call("composio_find_actions", { query: "pull request" })) as { matches: Array<{ input: unknown }> };
    expect(found.matches[0].input).toEqual(input);
    pages.set("github:", { items: [{ ...tool("GITHUB_BROKEN"), input_parameters: null }], next_cursor: null });
    const broken = company("ak_schema_null");
    expect(await broken.call("composio_find_actions", { query: "broken" })).toBe("ERROR: Composio action GITHUB_BROKEN has an input schema that is not an object.");
    broken.connection.close();
    h.connection.close();
  });
});
