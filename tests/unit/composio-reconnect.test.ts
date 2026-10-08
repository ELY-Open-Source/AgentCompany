import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

type RemoteAccount = { id: string; toolkitSlug: string; status: string; authConfigId: string; createdAt: string };
const remote = new Map<string, RemoteAccount>();
let created = 0;
let failCreate = false;
const failDelete = new Set<string>();

vi.mock("../../src/main/services/composio/composio-client", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ComposioClient: class {
    async listAuthConfigs() {
      return [{ id: "ac_gh", toolkitSlug: "github", authScheme: "OAUTH2", status: "ENABLED" }];
    }
    async createConnectedAccount(input: { authConfigId: string }) {
      if (failCreate) throw new Error("Composio is down");
      const id = `ca_${++created}`;
      remote.set(id, { id, toolkitSlug: "github", status: "INITIATED", authConfigId: input.authConfigId, createdAt: new Date().toISOString() });
      return { id, redirectUrl: `https://connect.example/${id}` };
    }
    async deleteConnectedAccount(id: string) {
      if (failDelete.has(id)) throw new Error(`Composio could not delete ${id}`);
      remote.delete(id);
    }
    async listConnectedAccounts() {
      return [...remote.values()];
    }
  },
}));

const { ComposioConnectionService } = await import("../../src/main/services/composio/composio-connection-service");
const { DatabaseConnection } = await import("../../src/main/database/connection");
const { OrganizationService } = await import("../../src/main/services/organization-service");
const { IntegrationKeyStore } = await import("../../src/main/services/integration-key-store");
const { ConnectorGrantsService } = await import("../../src/main/services/composio/connector-grants");

const vault = { encryptSecret: (secret: string) => Buffer.from(secret, "utf8"), decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8") };

/** A company whose GitHub connection is authorized and granted to its CEO. */
async function connectedCompany() {
  remote.clear();
  failCreate = false;
  failDelete.clear();
  const connection = new DatabaseConnection(join(tmpdir(), `ac-reconnect-${randomUUID()}.db`));
  let orgId = "";
  let ceoId = "";
  connection.transaction(() => {
    orgId = new OrganizationService(connection.db).createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
    const providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
    ceoId = new OrganizationService(connection.db).createAgent({ orgId, name: "CEO", role: "CEO", department: "Executive", modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 1000, managerAgentId: null, roleLevel: "c_suite" });
  });
  const keys = new IntegrationKeyStore(connection.db, vault);
  keys.write("composio", `ak_${randomUUID()}`);
  const service = new ComposioConnectionService(connection.db, keys);
  const first = await service.connectToolkit(orgId, "github", "main");
  remote.get(first.accountId)!.status = "ACTIVE";
  await service.refreshAccounts(orgId);
  new ConnectorGrantsService(connection.db).grant({ orgId, agentId: ceoId, toolkitSlug: "github", accountLabel: null, grantedByType: "agent", grantedById: ceoId });
  const account = () => connection.db.prepare("select id, status, pending_account_id as pending from connector_accounts where org_id = ?").get(orgId) as { id: string; status: string; pending: string | null };
  const grants = () => (connection.db.prepare("select count(*) as n from agent_connector_grants where org_id = ?").get(orgId) as { n: number }).n;
  return { connection, orgId, service, oldId: first.accountId, account, grants };
}

describe("reconnecting a connector keeps the working account until the new one is authorized", () => {
  test("a reconnect the user abandons leaves the old account working", async () => {
    const h = await connectedCompany();
    const again = await h.service.connectToolkit(h.orgId, "github", "main");
    expect(h.account()).toEqual({ id: h.oldId, status: "ACTIVE", pending: again.accountId });
    expect(remote.has(h.oldId)).toBe(true);
    await h.service.refreshAccounts(h.orgId);
    expect(h.account()).toEqual({ id: h.oldId, status: "ACTIVE", pending: again.accountId });
    remote.get(again.accountId)!.status = "EXPIRED";
    await h.service.refreshAccounts(h.orgId);
    expect(h.account()).toEqual({ id: h.oldId, status: "ACTIVE", pending: null });
    expect([...remote.keys()]).toEqual([h.oldId]);
    expect(h.grants()).toBe(1);
    h.connection.close();
  });

  test("an authorized reconnect replaces the old account and keeps the grants", async () => {
    const h = await connectedCompany();
    const again = await h.service.connectToolkit(h.orgId, "github", "main");
    remote.get(again.accountId)!.status = "ACTIVE";
    await h.service.refreshAccounts(h.orgId);
    expect(h.account()).toEqual({ id: again.accountId, status: "ACTIVE", pending: null });
    expect([...remote.keys()]).toEqual([again.accountId]);
    expect(h.grants()).toBe(1);
    h.connection.close();
  });

  test("an earlier reconnect that cannot be deleted never replaces the working account", async () => {
    const h = await connectedCompany();
    const first = await h.service.connectToolkit(h.orgId, "github", "main");
    failDelete.add(first.accountId);
    await expect(h.service.connectToolkit(h.orgId, "github", "main")).rejects.toThrow(`Composio could not delete ${first.accountId}`);
    const second = [...remote.keys()].at(-1)!;
    expect(h.account()).toEqual({ id: h.oldId, status: "ACTIVE", pending: second });
    await h.service.refreshAccounts(h.orgId);
    expect(h.account()).toEqual({ id: h.oldId, status: "ACTIVE", pending: second });
    remote.get(first.accountId)!.status = "ACTIVE";
    failDelete.clear();
    await h.service.disconnectToolkit(h.orgId, "github", "main");
    expect(remote.size).toBe(0);
    await h.service.refreshAccounts(h.orgId);
    expect(h.account()).toBeUndefined();
    h.connection.close();
  });

  test("a second account of a toolkit lives beside the first, and removing it leaves the first", async () => {
    const h = await connectedCompany();
    const sales = await h.service.connectToolkit(h.orgId, "github", "Sales");
    remote.get(sales.accountId)!.status = "ACTIVE";
    await h.service.refreshAccounts(h.orgId);
    const rows = () => h.connection.db.prepare("select id, label, status from connector_accounts where org_id = ? order by label").all(h.orgId);
    expect(rows()).toEqual([{ id: h.oldId, label: "main", status: "ACTIVE" }, { id: sales.accountId, label: "sales", status: "ACTIVE" }]);
    await h.service.disconnectToolkit(h.orgId, "github", "sales");
    expect(rows()).toEqual([{ id: h.oldId, label: "main", status: "ACTIVE" }]);
    expect([...remote.keys()]).toEqual([h.oldId]);
    expect(h.grants()).toBe(1);
    h.connection.close();
  });

  test("several accounts made outside the app for one toolkit are each adopted, none folded into another", async () => {
    const h = await connectedCompany();
    for (const id of ["ca_slack_b", "ca_slack_a"]) remote.set(id, { id, toolkitSlug: "slack", status: "ACTIVE", authConfigId: "ac_slack", createdAt: new Date().toISOString() });
    remote.set("ca_notion", { id: "ca_notion", toolkitSlug: "notion", status: "ACTIVE", authConfigId: "ac_notion", createdAt: new Date().toISOString() });
    await h.service.refreshAccounts(h.orgId);
    const rows = h.connection.db.prepare("select id, toolkit_slug as toolkit, label from connector_accounts where org_id = ? order by toolkit_slug, label").all(h.orgId);
    expect(rows).toEqual([
      { id: h.oldId, toolkit: "github", label: "main" },
      { id: "ca_notion", toolkit: "notion", label: "main" },
      { id: "ca_slack_a", toolkit: "slack", label: "ca_slack_a" },
      { id: "ca_slack_b", toolkit: "slack", label: "ca_slack_b" },
    ]);
    h.connection.close();
  });

  test("a disconnect that fails partway leaves the account both working and shown", async () => {
    const h = await connectedCompany();
    remote.set("ca_leftover", { id: "ca_leftover", toolkitSlug: "github", status: "INITIATED", authConfigId: "ac_gh", createdAt: new Date().toISOString() });
    failDelete.add("ca_leftover");
    await expect(h.service.disconnectToolkit(h.orgId, "github", "main")).rejects.toThrow("Composio could not delete ca_leftover");
    expect(remote.has(h.oldId)).toBe(true);
    expect(h.account()).toEqual({ id: h.oldId, status: "ACTIVE", pending: null });
    expect(h.grants()).toBe(1);
    h.connection.close();
  });

  test("a reconnect whose old account cannot be deleted still moves the row and its grants to the new account", async () => {
    const h = await connectedCompany();
    const again = await h.service.connectToolkit(h.orgId, "github", "main");
    remote.get(again.accountId)!.status = "ACTIVE";
    failDelete.add(h.oldId);
    await expect(h.service.refreshAccounts(h.orgId)).rejects.toThrow(`Composio could not delete ${h.oldId}`);
    expect(h.account()).toEqual({ id: again.accountId, status: "ACTIVE", pending: null });
    expect(h.grants()).toBe(1);
    await h.service.refreshAccounts(h.orgId);
    expect(h.account()).toEqual({ id: again.accountId, status: "ACTIVE", pending: null });
    expect(h.grants()).toBe(1);
    h.connection.close();
  });

  test("a reconnect that cannot start touches nothing", async () => {
    const h = await connectedCompany();
    failCreate = true;
    await expect(h.service.connectToolkit(h.orgId, "github", "main")).rejects.toThrow("Composio is down");
    expect(h.account()).toEqual({ id: h.oldId, status: "ACTIVE", pending: null });
    expect([...remote.keys()]).toEqual([h.oldId]);
    h.connection.close();
  });
});
