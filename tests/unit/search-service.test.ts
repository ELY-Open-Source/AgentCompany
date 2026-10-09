import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
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

    const results = search.search({ orgId, employeeId, query: "production", entityTypes: ["task"] }).results;
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

    const hits = search.search({ orgId, employeeId: ownerId, query: "secret", entityTypes: ["chat_message"] }).results;
    expect(hits).toHaveLength(1);
    // A hit names its conversation and thread, so opening it shows the message itself.
    const message = connection.db.prepare("select space_id, thread_id from chat_messages where id = ?").get(hits[0]!.entityId) as { space_id: string; thread_id: string };
    expect(hits[0]!.facets).toMatchObject({ space: spaceId, thread: message.thread_id });
    expect(message.space_id).toBe(spaceId);
    expect(search.search({ orgId, employeeId: outsiderId, query: "secret", entityTypes: ["chat_message"] }).results).toHaveLength(0);
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

    const docs = search.search({ orgId, employeeId, query: "twelve hundred" }).results;
    expect(docs.map((r) => [r.entityType, r.title, r.facets.kind])).toEqual([["document", "Pricing memo", "memo"]]);
    const entries = search.search({ orgId, employeeId, query: "refunds", entityTypes: ["knowledge"] }).results;
    expect(entries.map((r) => r.facets.state).sort()).toEqual(["active", "superseded"]);
    connection.close();
  });

  test("lists only current file versions, as the Files page does", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const search = new SearchService(connection.db);
    let orgId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Files Co", employeeName: "Dana Lee", mission: "m", goal: "g" });
    });
    const employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
    const file = (id: string, supersededAt: string | null) => connection.db.prepare(`
      insert into file_objects(id, org_id, name, kind, size_bytes, sha256, storage_path, owner_type, owner_id, created_at, superseded_at)
      values (?, ?, 'roadmap.md', 'md', 1, ?, '/tmp/x', 'employee', ?, ?, ?)
    `).run(id, orgId, id, employeeId, new Date().toISOString(), supersededAt);
    file("fil_old", new Date().toISOString());
    file("fil_new", null);
    expect(search.search({ orgId, employeeId, query: "roadmap", entityTypes: ["file"] }).results.map((hit) => hit.entityId)).toEqual(["fil_new"]);
    connection.close();
  });

  test("counts every readable match and pages through them", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const search = new SearchService(connection.db);
    let orgId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Paging Co", employeeName: "Dana Lee", mission: "m", goal: "g" });
      for (let index = 0; index < 30; index += 1) {
        organization.createTask({
          orgId, title: `Quarterly audit ${index}`, description: "d", status: TASK_STATUS.BACKLOG, assigneeAgentId: null, risk: "low",
          projectId: null, goalId: null, workspaceId: null, priority: "normal", requiresFilesystem: false,
        });
      }
    });
    const employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
    const first = search.search({ orgId, employeeId, query: "quarterly", entityTypes: ["task"], limit: 12 });
    expect(first.results).toHaveLength(12);
    expect(first.total).toBe(30);
    const last = search.search({ orgId, employeeId, query: "quarterly", entityTypes: ["task"], limit: 12, offset: 24 });
    expect(last.results).toHaveLength(6);
    const seen = new Set([...first.results, ...search.search({ orgId, employeeId, query: "quarterly", entityTypes: ["task"], limit: 12, offset: 12 }).results, ...last.results].map((hit) => hit.entityId));
    expect(seen.size).toBe(30);
    expect(search.search({ orgId, employeeId, query: "nothinglikethis", limit: 12 })).toEqual({ results: [], total: 0 });
    connection.close();
  });

  test("finds Chinese words inside text, alone or with English words", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const search = new SearchService(connection.db);
    let orgId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "中文公司", employeeName: "Dana Lee", mission: "m", goal: "g" });
      for (const title of ["数据迁移计划", "数据迁移 rollout plan", "Quarterly rollout", "100%_完成", "CAFÉ migration"]) {
        organization.createTask({
          orgId, title, description: "d", status: TASK_STATUS.BACKLOG, assigneeAgentId: null, risk: "low",
          projectId: null, goalId: null, workspaceId: null, priority: "normal", requiresFilesystem: false,
        });
      }
    });
    const employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
    const titles = (query: string) => search.search({ orgId, employeeId, query, entityTypes: ["task"] }).results.map((hit) => hit.title).sort();
    expect(titles("迁移")).toEqual(["数据迁移 rollout plan", "数据迁移计划"]);
    expect(titles("迁移 rollout")).toEqual(["数据迁移 rollout plan"]);
    expect(titles("rollout")).toEqual(["Quarterly rollout", "数据迁移 rollout plan"]);
    // LIKE wildcards in the words are taken literally.
    expect(titles("%_完")).toEqual(["100%_完成"]);
    // Letters outside ASCII match whatever their case.
    expect(titles("café")).toEqual(["CAFÉ migration"]);
    expect(titles("CAFÉ")).toEqual(["CAFÉ migration"]);
    expect(search.search({ orgId, employeeId, query: "!!", entityTypes: ["task"] })).toEqual({ results: [], total: 0 });
    connection.close();
  });

  test("filters by type and permission before cutting a page, so a readable match behind many unreadable ones is found", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const chat = new ChatService(connection.db);
    const search = new SearchService(connection.db);
    let orgId = "";
    let ownerId = "";
    const outsiderId = createId("emp");
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Order Co", employeeName: "Dana Lee", mission: "m", goal: "g" });
      ownerId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
      connection.db.prepare("insert into employees(id, org_id, display_name, role, created_at) values (?, ?, ?, ?, ?)")
        .run(outsiderId, orgId, "Riley Chen", "Observer", new Date().toISOString());
      const spaceId = chat.createSpace({ orgId, spaceType: "project", name: "private-beacon", topic: "t", visibility: "restricted", memberEmployeeIds: [ownerId] });
      // The strongest matches are messages the outsider may not read.
      for (let index = 0; index < 100; index += 1) {
        chat.sendMessage({ orgId, spaceId, threadId: null, senderType: "employee", senderId: ownerId, bodyMd: "beacon beacon beacon", attachmentFileIds: [] });
      }
      organization.createTask({
        orgId, title: "Harbor survey", description: `A long survey of the harbor that mentions the beacon only once. ${"Plain words. ".repeat(40)}`,
        status: TASK_STATUS.BACKLOG, assigneeAgentId: null, risk: "low", projectId: null, goalId: null, workspaceId: null, priority: "normal", requiresFilesystem: false,
      });
    });
    const outsider = search.search({ orgId, employeeId: outsiderId, query: "beacon", limit: 12 });
    expect(outsider.total).toBe(1);
    expect(outsider.results.map((hit) => hit.title)).toEqual(["Harbor survey"]);
    // The same holds for a type filter behind many matches of other types.
    const tasks = search.search({ orgId, employeeId: ownerId, query: "beacon", entityTypes: ["task"], limit: 12 });
    expect(tasks.results.map((hit) => hit.title)).toEqual(["Harbor survey"]);
    connection.close();
  });

  test("finds a text file by what it says, read from its verified copy", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const search = new SearchService(connection.db);
    let orgId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Content Co", employeeName: "Dana Lee", mission: "m", goal: "g" });
    });
    const employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
    const folder = join(tmpdir(), `ac-search-files-${randomUUID()}`);
    mkdirSync(folder, { recursive: true });
    const stored = (id: string, name: string, text: string, scanState = "approved") => {
      const path = join(folder, name);
      writeFileSync(path, text);
      connection.db.prepare(`
        insert into file_objects(id, org_id, name, kind, size_bytes, sha256, storage_path, owner_type, owner_id, created_at, scan_state)
        values (?, ?, ?, 'doc', ?, ?, ?, 'employee', ?, ?, ?)
      `).run(id, orgId, name, Buffer.byteLength(text), createHash("sha256").update(text).digest("hex"), path, employeeId, new Date().toISOString(), scanState);
      return path;
    };
    stored("fil_notes", "notes.md", "Quokka migration checklist");
    stored("fil_scan", "scan.pdf", "Quokka migration checklist");
    stored("fil_key", "deploy-key.txt", "-----BEGIN PRIVATE KEY----- walrussecret", "blocked");
    const changed = stored("fil_changed", "changed.txt", "Quokka original words");
    writeFileSync(changed, "Quokka rewritten behind the app's back");
    const ids = (query: string) => search.search({ orgId, employeeId, query, entityTypes: ["file"] }).results.map((hit) => hit.entityId).sort();
    expect(ids("checklist")).toEqual(["fil_notes"]);
    // Bytes that no longer match their record are not indexed; the file is still found by name.
    expect(ids("rewritten")).toEqual([]);
    expect(ids("changed")).toEqual(["fil_changed"]);
    // A blocked file's content stays behind the scan gate; its name is still searchable.
    expect(ids("walrussecret")).toEqual([]);
    const blocked = search.search({ orgId, employeeId, query: "deploy", entityTypes: ["file"] }).results;
    expect(blocked.map((hit) => hit.entityId)).toEqual(["fil_key"]);
    expect(blocked[0]!.preview).not.toContain("PRIVATE KEY");
    connection.close();
  });

  test("indexes a company once, then redoes only what changed", () => {
    const connection = createConnection();
    const db = connection.db;
    const organization = new OrganizationService(db);
    const search = new SearchService(db);
    let orgId = "";
    let taskId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Index Co", employeeName: "Dana Lee", mission: "m", goal: "g" });
      taskId = organization.createTask({
        orgId, title: "Osprey survey", description: "d", status: TASK_STATUS.BACKLOG, assigneeAgentId: null, risk: "low",
        projectId: null, goalId: null, workspaceId: null, priority: "normal", requiresFilesystem: false,
      });
    });
    const employeeId = (db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
    const titles = (query: string) => search.search({ orgId, employeeId, query }).results.map((hit) => hit.title);
    const indexRows = () => db.prepare("select rowid from search_documents where org_id = ? order by rowid").all(orgId);
    expect(titles("osprey")).toEqual(["Osprey survey"]);
    expect(db.prepare("select org_id from search_built").all()).toEqual([{ org_id: orgId }]);
    // Nothing changed, nothing is rewritten.
    const before = indexRows();
    expect(titles("osprey")).toEqual(["Osprey survey"]);
    expect(indexRows()).toEqual(before);
    // Edits, additions and removals are queued and applied on the next search.
    db.prepare("update tasks set title = 'Heron survey' where id = ?").run(taskId);
    connection.transaction(() => organization.createTask({
      orgId, title: "Kestrel count", description: "d", status: TASK_STATUS.BACKLOG, assigneeAgentId: null, risk: "low",
      projectId: null, goalId: null, workspaceId: null, priority: "normal", requiresFilesystem: false,
    }));
    expect(db.prepare("select count(*) as n from search_pending where org_id = ?").get(orgId)).toEqual({ n: 2 });
    expect(titles("osprey")).toEqual([]);
    expect(titles("heron")).toEqual(["Heron survey"]);
    expect(titles("kestrel")).toEqual(["Kestrel count"]);
    expect(db.prepare("select count(*) as n from search_pending where org_id = ?").get(orgId)).toEqual({ n: 0 });
    // A knowledge entry's state is read against the clock, not frozen at indexing.
    new KnowledgeService(db).create({
      orgId, topic: "Ferry timetable", category: "policy", content: "Ferries leave hourly.", importance: "normal",
      sourceType: "employee", sourceId: null, scopeType: "organization", scopeId: null, validUntil: "2030-01-01T00:00:00Z", supersedesId: null,
    });
    expect(search.search({ orgId, employeeId, query: "ferry", entityTypes: ["knowledge"] }).results[0]!.facets.state).toBe("active");
    vi.setSystemTime(new Date("2031-01-01T00:00:00Z"));
    try {
      expect(search.search({ orgId, employeeId, query: "ferry", entityTypes: ["knowledge"] }).results[0]!.facets.state).toBe("expired");
      expect(db.prepare("select count(*) as n from search_pending where org_id = ?").get(orgId)).toEqual({ n: 0 });
    } finally {
      vi.useRealTimers();
    }
    // A deleted company leaves no index behind.
    connection.transaction(() => organization.deleteOrganization(orgId));
    expect(db.prepare("select count(*) as n from search_documents where org_id = ?").get(orgId)).toEqual({ n: 0 });
    expect(db.prepare("select count(*) as n from search_built where org_id = ?").get(orgId)).toEqual({ n: 0 });
    connection.close();
  });
});
