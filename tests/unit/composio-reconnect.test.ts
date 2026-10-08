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
  const first = await service.connectToolkit(orgId, "github");
  remote.get(first.accountId)!.status = "ACTIVE";
  await service.refreshAccounts(orgId);
  new ConnectorGrantsService(connection.db).grant({ orgId, agentId: ceoId, toolkitSlug: "github", grantedByType: "agent", grantedById: ceoId });
  const account = () => connection.db.prepare("select id, status, pending_account_id as pending from connector_accounts where org_id = ?").get(orgId) as { id: string; status: string; pending: string | null };
  const grants = () => (connection.db.prepare("select count(*) as n from agent_connector_grants where org_id = ?").get(orgId) as { n: number }).n;
  return { connection, orgId, service, oldId: first.accountId, account, grants };
}

describe("reconnecting a connector keeps the working account until the new one is authorized", () => {
  test("a reconnect the user abandons leaves the old account working", async () => {
    const h = await connectedCompany();
    const again = await h.service.connectToolkit(h.orgId, "github");
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
    const again = await h.service.connectToolkit(h.orgId, "github");
    remote.get(again.accountId)!.status = "ACTIVE";
    await h.service.refreshAccounts(h.orgId);
    expect(h.account()).toEqual({ id: again.accountId, status: "ACTIVE", pending: null });
    expect([...remote.keys()]).toEqual([again.accountId]);
    expect(h.grants()).toBe(1);
    h.connection.close();
  });

  test("an earlier reconnect that cannot be deleted never replaces the working account", async () => {
    const h = await connectedCompany();
    const first = await h.service.connectToolkit(h.orgId, "github");
    failDelete.add(first.accountId);
    await expect(h.service.connectToolkit(h.orgId, "github")).rejects.toThrow(`Composio could not delete ${first.accountId}`);
    const second = [...remote.keys()].at(-1)!;
    expect(h.account()).toEqual({ id: h.oldId, status: "ACTIVE", pending: second });
    await h.service.refreshAccounts(h.orgId);
    expect(h.account()).toEqual({ id: h.oldId, status: "ACTIVE", pending: second });
    remote.get(first.accountId)!.status = "ACTIVE";
    failDelete.clear();
    await h.service.disconnectToolkit(h.orgId, "github");
    expect(remote.size).toBe(0);
    await h.service.refreshAccounts(h.orgId);
    expect(h.account()).toBeUndefined();
    h.connection.close();
  });

  test("a reconnect that cannot start touches nothing", async () => {
    const h = await connectedCompany();
    failCreate = true;
    await expect(h.service.connectToolkit(h.orgId, "github")).rejects.toThrow("Composio is down");
    expect(h.account()).toEqual({ id: h.oldId, status: "ACTIVE", pending: null });
    expect([...remote.keys()]).toEqual([h.oldId]);
    h.connection.close();
  });
});
