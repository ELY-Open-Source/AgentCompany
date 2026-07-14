import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { ensureCeoDirectSpace } from "../../src/main/services/ceo-direct-space";

interface Harness {
  connection: DatabaseConnection;
  orgId: string;
  employeeId: string;
  providerId: string;
}

function harness(options: { enableProvider?: boolean } = {}): Harness {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-ceo-dm-${randomUUID()}.db`));
  const organization = new OrganizationService(connection.db);
  let orgId = "";
  let providerId = "";
  connection.transaction(() => {
    orgId = organization.createOrganization({ organizationName: "OrbitOps", employeeName: "Yang", mission: "m", goal: "g" });
    providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
    if (options.enableProvider) {
      connection.db.prepare("update providers set enabled = 1 where id = ? and org_id = ?").run(providerId, orgId);
    }
  });
  const employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
  return { connection, orgId, employeeId, providerId };
}

function createCeo(h: Harness, name = "CEO"): string {
  const organization = new OrganizationService(h.connection.db);
  let id = "";
  h.connection.transaction(() => {
    id = organization.createAgent({
      orgId: h.orgId, name, role: "CEO", department: "Executive",
      modelProviderId: h.providerId, modelId: "gpt-5.4", budgetCents: 25000,
      managerAgentId: null, roleLevel: "c_suite",
    });
  });
  return id;
}

function spaceMembers(h: Harness, spaceId: string): Array<{ principal_type: string; principal_id: string }> {
  return h.connection.db.prepare("select principal_type, principal_id from chat_memberships where space_id = ? order by principal_type")
    .all(spaceId) as Array<{ principal_type: string; principal_id: string }>;
}

describe("ensureCeoDirectSpace", () => {
  test("creates the founder⇄CEO direct conversation with exactly those two members", () => {
    const h = harness();
    const ceoId = createCeo(h);

    const spaceId = ensureCeoDirectSpace(h.connection.db, h.orgId);
    expect(spaceId).toBeTruthy();

    const space = h.connection.db.prepare("select space_type, visibility from chat_spaces where id = ? and org_id = ?")
      .get(spaceId, h.orgId) as { space_type: string; visibility: string };
    expect(space.space_type).toBe("direct");
    expect(space.visibility).toBe("restricted");

    const members = spaceMembers(h, spaceId as string);
    expect(members).toEqual([
      { principal_type: "agent", principal_id: ceoId },
      { principal_type: "employee", principal_id: h.employeeId },
    ]);
  });

  test("is idempotent: repeated ensures return the same conversation", () => {
    const h = harness();
    createCeo(h);

    const first = ensureCeoDirectSpace(h.connection.db, h.orgId);
    const second = ensureCeoDirectSpace(h.connection.db, h.orgId);
    expect(second).toBe(first);

    const directSpaces = h.connection.db.prepare("select id from chat_spaces where org_id = ? and space_type = 'direct'")
      .all(h.orgId) as Array<{ id: string }>;
    expect(directSpaces).toHaveLength(1);
  });

  test("returns null and creates nothing while the org has no CEO", () => {
    const h = harness();
    expect(ensureCeoDirectSpace(h.connection.db, h.orgId)).toBeNull();
    const directSpaces = h.connection.db.prepare("select id from chat_spaces where org_id = ? and space_type = 'direct'")
      .all(h.orgId) as Array<{ id: string }>;
    expect(directSpaces).toHaveLength(0);
  });

  test("ignores a retired CEO", () => {
    const h = harness();
    const ceoId = createCeo(h);
    h.connection.db.prepare("update agents set lifecycle = 'retired' where id = ?").run(ceoId);
    expect(ensureCeoDirectSpace(h.connection.db, h.orgId)).toBeNull();
  });

  test("the founder's message in the ensured conversation wakes the CEO without an @mention", () => {
    const h = harness({ enableProvider: true });
    const ceoId = createCeo(h);
    const spaceId = ensureCeoDirectSpace(h.connection.db, h.orgId) as string;

    new ChatService(h.connection.db).sendMessage({
      orgId: h.orgId,
      spaceId,
      threadId: null,
      senderType: "employee",
      senderId: h.employeeId,
      bodyMd: "How is the launch tracking against the goal?",
      attachmentFileIds: [],
    });

    const runs = h.connection.db.prepare(
      "select count(*) as count from task_runs where org_id = ? and agent_id = ? and trigger = 'chat_mention'",
    ).get(h.orgId, ceoId) as { count: number };
    expect(runs.count).toBe(1);
  });
});
