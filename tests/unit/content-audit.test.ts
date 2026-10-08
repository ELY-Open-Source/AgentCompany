import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { DocumentService } from "../../src/main/services/document-service";
import { KnowledgeService } from "../../src/main/services/knowledge-service";

function setup() {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-audit-${randomUUID()}.db`));
  let orgId = "";
  connection.transaction(() => {
    orgId = new OrganizationService(connection.db).createOrganization({ organizationName: "A", employeeName: "Eve", mission: "m", goal: "g" });
  });
  const employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
  const events = (entityId: string) => connection.db.prepare(
    "select actor_type, actor_id, action, payload_json from audit_events where entity_id = ? order by rowid",
  ).all(entityId).map((row) => ({ ...row, payload_json: JSON.parse(String(row.payload_json)) }));
  return { connection, orgId, employeeId, events };
}

describe("content audit", () => {
  test("document updates and deletion record who changed what", () => {
    const { connection, orgId, employeeId, events } = setup();
    const documents = new DocumentService(connection.db);
    const id = documents.create({ orgId, title: "Spec", docType: "spec", content: "v1", authorAgentId: null, reviewerAgentId: null, projectId: null, goalId: null, taskId: null });
    documents.update({ orgId, documentId: id, title: "Spec v2", content: "v2", status: "review", reason: "Added API", changedByType: "employee", changedById: employeeId });
    documents.delete({ orgId, documentId: id, deletedByEmployeeId: employeeId });

    expect(events(id).slice(1)).toEqual([
      { actor_type: "employee", actor_id: employeeId, action: "revised", payload_json: { version: 2, reason: "Added API", title: "Spec v2", status: "review", previousTitle: "Spec", previousStatus: "draft" } },
      { actor_type: "employee", actor_id: employeeId, action: "deleted", payload_json: { title: "Spec v2", docType: "spec", status: "review", version: 2, content: "v2" } },
    ]);
    expect(() => documents.delete({ orgId, documentId: id, deletedByEmployeeId: employeeId })).toThrow("Document was not found.");
    connection.close();
  });

  test("knowledge deletion records the removed entry and who removed it", () => {
    const { connection, orgId, employeeId, events } = setup();
    const knowledge = new KnowledgeService(connection.db);
    const id = knowledge.create({
      orgId, topic: "Refunds", category: "policy", content: "14 days", importance: "high",
      sourceType: "employee", sourceId: employeeId, scopeType: "organization", scopeId: null, validUntil: null, supersedesId: null,
    });
    knowledge.delete({ orgId, entryId: id, deletedByEmployeeId: employeeId });

    expect(events(id).at(-1)).toEqual({
      actor_type: "employee", actor_id: employeeId, action: "deleted",
      payload_json: { topic: "Refunds", category: "policy", content: "14 days", importance: "high", scopeType: "organization", scopeId: null, revision: 1 },
    });
    connection.close();
  });

  test("changes by someone outside the organization are refused", () => {
    const { connection, orgId, employeeId } = setup();
    const documents = new DocumentService(connection.db);
    const id = documents.create({ orgId, title: "Spec", docType: "spec", content: "v1", authorAgentId: null, reviewerAgentId: null, projectId: null, goalId: null, taskId: null });
    expect(() => documents.update({ orgId, documentId: id, title: "Spec", content: "v2", status: "draft", reason: "r", changedByType: "employee", changedById: "emp_stranger" }))
      .toThrow('No employee "emp_stranger" in this organization.');
    const knowledge = new KnowledgeService(connection.db);
    const entryId = knowledge.create({
      orgId, topic: "T", category: "fact", content: "c", importance: "normal",
      sourceType: "employee", sourceId: null, scopeType: "organization", scopeId: null, validUntil: null, supersedesId: null,
    });
    expect(() => knowledge.update({ orgId, entryId, topic: "T", category: "fact", content: "c2", importance: "normal", reason: "r", changedByType: "agent", changedById: "agt_stranger" }))
      .toThrow('No agent "agt_stranger" in this organization.');
    const badType = { orgId, documentId: id, title: "Spec", content: "v2", status: "draft", reason: "r", changedByType: "system" as "agent", changedById: employeeId };
    expect(() => documents.update(badType)).toThrow('Unknown actor type "system".');
    expect(documents.versions(orgId, id)).toHaveLength(1);
    expect(knowledge.revisions(orgId, entryId)).toHaveLength(1);
    expect(() => documents.delete({ orgId, documentId: id, deletedByEmployeeId: "emp_stranger" })).toThrow('No employee "emp_stranger" in this organization.');
    expect(connection.db.prepare("select count(*) as n from documents where id = ?").get(id)).toEqual({ n: 1 });
    connection.close();
  });
});
