import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { DocumentService } from "../../src/main/services/document-service";
import { documentVersionsSchema } from "../../src/main/database/migrations/065-document-versions";

describe("document versions", () => {
  test("every update is a new version; earlier versions stay intact, even after deletion", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-docver-${randomUUID()}.db`));
    let orgId = "";
    connection.transaction(() => {
      orgId = new OrganizationService(connection.db).createOrganization({ organizationName: "V", employeeName: "Y", mission: "m", goal: "g" });
    });
    const documents = new DocumentService(connection.db);
    const employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
    const id = documents.create({ orgId, title: "Spec", docType: "spec", content: "v1 body", authorAgentId: null, reviewerAgentId: null, projectId: null, goalId: null, taskId: null });
    expect(documents.update({ orgId, documentId: id, title: "Spec", content: "v2 body", status: "review", reason: "Added API", changedByType: "employee", changedById: employeeId })).toBe(2);
    expect(() => documents.update({ orgId, documentId: id, title: "Spec", content: "v3", status: "review", reason: " ", changedByType: "employee", changedById: employeeId }))
      .toThrow("A document update needs a reason.");
    expect(documents.versions(orgId, id).map((v) => [v.version, v.content, v.status, v.reason])).toEqual([
      [1, "v1 body", "draft", "created"],
      [2, "v2 body", "review", "Added API"],
    ]);
    expect(connection.db.prepare("select version, content from documents where id = ?").get(id)).toEqual({ version: 2, content: "v2 body" });
    documents.delete({ orgId, documentId: id, deletedByEmployeeId: employeeId });
    expect(documents.versions(orgId, id)).toHaveLength(2);
    connection.close();
  });

  test("the migration records each existing document as version 1", () => {
    const db = new DatabaseSync(join(tmpdir(), `ac-docmig-${randomUUID()}.db`));
    db.exec(`
      create table organizations(id text primary key);
      create table schema_migrations(version integer primary key, name text not null, applied_at text not null);
      create table documents(id text primary key, org_id text, title text, content text, status text, author_agent_id text, created_at text);
      insert into organizations values ('org_1');
      insert into documents values ('doc_1', 'org_1', 'T', 'C', 'approved', 'agt_1', '2026-01-01T00:00:00.000Z');
    `);
    db.exec(documentVersionsSchema);
    expect(db.prepare("select document_id, version, content, status, changed_by_type, changed_by_id, reason from document_versions").all())
      .toEqual([{ document_id: "doc_1", version: 1, content: "C", status: "approved", changed_by_type: "agent", changed_by_id: "agt_1", reason: "created" }]);
    expect(db.prepare("select version from documents").get()).toEqual({ version: 1 });
    db.close();
  });
});
