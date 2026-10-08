import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { ChatService } from "../../src/main/services/chat-service";
import { OrganizationService } from "../../src/main/services/organization-service";
import { SearchService } from "../../src/main/services/search-service";
import { DocumentService } from "../../src/main/services/document-service";
import { KnowledgeService } from "../../src/main/services/knowledge-service";
import { TASK_STATUS } from "../../src/shared/domain";
import { createId } from "../../src/shared/ids";

function createConnection(): DatabaseConnection {
  return new DatabaseConnection(join(tmpdir(), `agentcompany-new-search-${randomUUID()}.db`));
}

describe("search service", () => {
  test("returns faceted full-text results", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const search = new SearchService(connection.db);
    let orgId = "";
    let employeeId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
      organization.createTask({
        orgId,
        title: "Production deploy",
        description: "Release the production deploy checklist.",
        status: TASK_STATUS.BACKLOG,
        assigneeAgentId: null,
        risk: "high",
        projectId: null,
        goalId: null,
        workspaceId: null,
        priority: "normal",
        requiresFilesystem: false,
      });
    });

    const results = search.search({ orgId, employeeId, query: "production", entityTypes: ["task"] });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ entityType: "task", title: "Production deploy", facets: { type: "Work", risk: "high" } });
    connection.close();
  });

  test("filters restricted chat messages by membership", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const chat = new ChatService(connection.db);
    const search = new SearchService(connection.db);
    let orgId = "";
    let ownerId = "";
    let outsiderId = "";
    let spaceId = "";

    connection.transaction(() => {
      orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      ownerId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
      outsiderId = createId("emp");
      connection.db.prepare("insert into employees(id, org_id, display_name, role, created_at) values (?, ?, ?, ?, ?)")
        .run(outsiderId, orgId, "Riley Chen", "Observer", new Date().toISOString());
      spaceId = chat.createSpace({
        orgId,
        spaceType: "project",
        name: "restricted-release",
        topic: "Need-to-know release",
        visibility: "restricted",
        memberEmployeeIds: [ownerId],
      });
      chat.sendMessage({
        orgId,
        spaceId,
        threadId: null,
        senderType: "employee",
        senderId: ownerId,
        bodyMd: "Secret launch window",
        attachmentFileIds: [],
      });
    });

    expect(search.search({ orgId, employeeId: ownerId, query: "secret", entityTypes: ["chat_message"] })).toHaveLength(1);
    expect(search.search({ orgId, employeeId: outsiderId, query: "secret", entityTypes: ["chat_message"] })).toHaveLength(0);
    connection.close();
  });

  test("finds documents and knowledge by their bodies, with state facets", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const search = new SearchService(connection.db);
    let orgId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Lib", employeeName: "Dana Lee", mission: "m", goal: "g" });
    });
    const employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
    new DocumentService(connection.db).create({
      orgId, title: "Pricing memo", docType: "memo", content: "Enterprise tier costs twelve hundred dollars.",
      authorAgentId: null, reviewerAgentId: null, projectId: null, goalId: null, taskId: null,
    });
    const knowledge = new KnowledgeService(connection.db);
    const oldId = knowledge.create({
      orgId, topic: "Refund window", category: "policy", content: "Refunds within fourteen days.", importance: "normal",
      sourceType: "employee", sourceId: null, scopeType: "organization", scopeId: null, validUntil: null, supersedesId: null,
    });
    knowledge.create({
      orgId, topic: "Refund window", category: "policy", content: "Refunds within thirty days.", importance: "normal",
      sourceType: "employee", sourceId: null, scopeType: "organization", scopeId: null, validUntil: null, supersedesId: oldId,
    });

    const docs = search.search({ orgId, employeeId, query: "twelve hundred" });
    expect(docs.map((r) => [r.entityType, r.title, r.facets.kind])).toEqual([["document", "Pricing memo", "memo"]]);
    const entries = search.search({ orgId, employeeId, query: "refunds", entityTypes: ["knowledge"] });
    expect(entries.map((r) => r.facets.state).sort()).toEqual(["active", "superseded"]);
    connection.close();
  });
});
