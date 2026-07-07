import type { DatabaseSync } from "node:sqlite";
import type { SearchInput } from "../../shared/commands";
import { SEARCH_ENTITY_TYPES, type SearchEntityType, type SearchResultRecord } from "../../shared/domain";

interface SearchRow {
  entity_type: SearchEntityType;
  entity_id: string;
  title: string;
  body: string;
  facet_json: string;
}

interface SearchDoc {
  entityType: SearchEntityType;
  entityId: string;
  title: string;
  body: string;
  facets: Record<string, string>;
}

export class SearchService {
  constructor(private readonly db: DatabaseSync) {}

  search(input: SearchInput): SearchResultRecord[] {
    this.assertEmployee(input.orgId, input.employeeId);
    const query = normalizeQuery(input.query);
    const limit = Math.max(1, Math.min(input.limit ?? 20, 50));
    const entityTypes = validEntityTypes(input.entityTypes ?? [...SEARCH_ENTITY_TYPES]);
    this.reindexOrg(input.orgId);
    const rows = query
      ? this.db.prepare(`
        select entity_type, entity_id, title, body, facet_json
        from search_documents
        where search_documents match ? and org_id = ?
        limit ?
      `).all(query, input.orgId, limit * 4) as unknown as SearchRow[]
      : this.db.prepare(`
        select entity_type, entity_id, title, body, facet_json
        from search_documents
        where org_id = ?
        order by rowid desc
        limit ?
      `).all(input.orgId, limit * 4) as unknown as SearchRow[];
    return rows
      .filter((row) => entityTypes.has(row.entity_type))
      .filter((row) => this.canRead(input.orgId, input.employeeId, row.entity_type, row.entity_id))
      .slice(0, limit)
      .map((row) => ({
        entityType: row.entity_type,
        entityId: row.entity_id,
        title: row.title,
        preview: preview(row.body),
        facets: parseFacets(row.facet_json),
      }));
  }

  private reindexOrg(orgId: string): void {
    this.db.exec("savepoint search_reindex");
    try {
      this.db.prepare("delete from search_documents where org_id = ?").run(orgId);
      const insert = this.db.prepare(`
        insert into search_documents(org_id, entity_type, entity_id, title, body, facet_json)
        values (?, ?, ?, ?, ?, ?)
      `);
      for (const doc of this.documents(orgId)) {
        insert.run(orgId, doc.entityType, doc.entityId, doc.title, doc.body, JSON.stringify(doc.facets));
      }
      this.db.exec("release search_reindex");
    } catch (error) {
      this.db.exec("rollback to search_reindex");
      this.db.exec("release search_reindex");
      throw error;
    }
  }

  private documents(orgId: string): SearchDoc[] {
    return [
      ...this.employeeDocs(orgId),
      ...this.agentDocs(orgId),
      ...this.taskDocs(orgId),
      ...this.projectDocs(orgId),
      ...this.goalDocs(orgId),
      ...this.workspaceDocs(orgId),
      ...this.approvalDocs(orgId),
      ...this.chatSpaceDocs(orgId),
      ...this.chatMessageDocs(orgId),
      ...this.fileDocs(orgId),
      ...this.providerDocs(orgId),
      ...this.socialDocs(orgId),
      ...this.scheduledPostDocs(orgId),
    ];
  }

  private employeeDocs(orgId: string): SearchDoc[] {
    const rows = this.db.prepare("select id, display_name, role from employees where org_id = ?").all(orgId) as Array<{ id: string; display_name: string; role: string }>;
    return rows.map((row) => doc("employee", row.id, row.display_name, row.role, { type: "People" }));
  }

  private agentDocs(orgId: string): SearchDoc[] {
    const rows = this.db.prepare("select id, name, role, department, title from agents where org_id = ?").all(orgId) as Array<{ id: string; name: string; role: string; department: string; title: string }>;
    return rows.map((row) => doc("agent", row.id, row.name, [row.role, row.department, row.title].join(" "), { type: "People", department: row.department }));
  }

  private taskDocs(orgId: string): SearchDoc[] {
    const rows = this.db.prepare("select id, title, description, status, risk from tasks where org_id = ?").all(orgId) as Array<{ id: string; title: string; description: string; status: string; risk: string }>;
    return rows.map((row) => doc("task", row.id, row.title, row.description, { type: "Work", status: row.status, risk: row.risk }));
  }

  private projectDocs(orgId: string): SearchDoc[] {
    const rows = this.db.prepare("select id, name, description, status from projects where org_id = ?").all(orgId) as Array<{ id: string; name: string; description: string; status: string }>;
    return rows.map((row) => doc("project", row.id, row.name, row.description, { type: "Work", status: row.status }));
  }

  private goalDocs(orgId: string): SearchDoc[] {
    const rows = this.db.prepare("select id, title, description, status from goals where org_id = ?").all(orgId) as Array<{ id: string; title: string; description: string; status: string }>;
    return rows.map((row) => doc("goal", row.id, row.title, row.description, { type: "Work", status: row.status }));
  }

  private workspaceDocs(orgId: string): SearchDoc[] {
    const rows = this.db.prepare("select id, name, local_path, repo_url from workspaces where org_id = ?").all(orgId) as Array<{ id: string; name: string; local_path: string; repo_url: string }>;
    return rows.map((row) => doc("workspace", row.id, row.name, `${row.local_path} ${row.repo_url}`, { type: "Work" }));
  }

  private approvalDocs(orgId: string): SearchDoc[] {
    const rows = this.db.prepare("select id, title, details, state, risk from approvals where org_id = ?").all(orgId) as Array<{ id: string; title: string; details: string; state: string; risk: string }>;
    return rows.map((row) => doc("approval", row.id, row.title, row.details, { type: "Governance", state: row.state, risk: row.risk }));
  }

  private chatSpaceDocs(orgId: string): SearchDoc[] {
    const rows = this.db.prepare("select id, name, topic, visibility from chat_spaces where org_id = ?").all(orgId) as Array<{ id: string; name: string; topic: string; visibility: string }>;
    return rows.map((row) => doc("chat_space", row.id, row.name, row.topic, { type: "Messages", visibility: row.visibility }));
  }

  private chatMessageDocs(orgId: string): SearchDoc[] {
    const rows = this.db.prepare("select id, thread_id, body_md, sender_type from chat_messages where org_id = ? and deleted_at is null").all(orgId) as Array<{ id: string; thread_id: string; body_md: string; sender_type: string }>;
    return rows.map((row) => doc("chat_message", row.id, createTitle(row.body_md), row.body_md, { type: "Messages", sender: row.sender_type, thread: row.thread_id }));
  }

  private fileDocs(orgId: string): SearchDoc[] {
    const rows = this.db.prepare("select id, name, kind, sha256, scan_state from file_objects where org_id = ?").all(orgId) as Array<{ id: string; name: string; kind: string; sha256: string; scan_state: string }>;
    return rows.map((row) => doc("file", row.id, row.name, `${row.kind} ${row.sha256}`, { type: "Files", state: row.scan_state }));
  }

  private providerDocs(orgId: string): SearchDoc[] {
    const rows = this.db.prepare("select id, label, provider_key, auth_state, health_state from providers where org_id = ?").all(orgId) as Array<{ id: string; label: string; provider_key: string; auth_state: string; health_state: string }>;
    return rows.map((row) => doc("provider", row.id, row.label, row.provider_key, { type: "Settings", auth: row.auth_state, health: row.health_state }));
  }

  private socialDocs(orgId: string): SearchDoc[] {
    const rows = this.db.prepare("select id, platform, handle, display_name from social_accounts where org_id = ?").all(orgId) as Array<{ id: string; platform: string; handle: string; display_name: string }>;
    return rows.map((row) => doc("social_account", row.id, row.display_name, `${row.platform} ${row.handle}`, { type: "Social", platform: row.platform }));
  }

  private scheduledPostDocs(orgId: string): SearchDoc[] {
    const rows = this.db.prepare("select id, social_account_id, body_md, state from scheduled_posts where org_id = ?").all(orgId) as Array<{ id: string; social_account_id: string; body_md: string; state: string }>;
    return rows.map((row) => doc("scheduled_post", row.id, createTitle(row.body_md), row.body_md, { type: "Social", state: row.state, account: row.social_account_id }));
  }

  private canRead(orgId: string, employeeId: string, entityType: SearchEntityType, entityId: string): boolean {
    if (entityType === "chat_space") return this.canReadSpace(entityId, employeeId);
    if (entityType === "chat_message") return this.canReadMessage(orgId, entityId, employeeId);
    if (entityType === "file") return this.canReadFile(orgId, entityId, employeeId);
    if (entityType === "social_account") return this.canReadSocialAccount(entityId, employeeId);
    if (entityType === "scheduled_post") return this.canReadScheduledPost(entityId, employeeId);
    return true;
  }

  private canReadSpace(spaceId: string, employeeId: string): boolean {
    const row = this.db.prepare("select space_id from chat_memberships where space_id = ? and principal_type = 'employee' and principal_id = ?")
      .get(spaceId, employeeId);
    return Boolean(row);
  }

  private canReadMessage(orgId: string, messageId: string, employeeId: string): boolean {
    const row = this.db.prepare("select space_id from chat_messages where id = ? and org_id = ?").get(messageId, orgId) as { space_id: string } | undefined;
    return row ? this.canReadSpace(row.space_id, employeeId) : false;
  }

  private canReadFile(orgId: string, fileId: string, employeeId: string): boolean {
    const file = this.db.prepare("select owner_type, owner_id from file_objects where id = ? and org_id = ?").get(fileId, orgId) as { owner_type: string; owner_id: string | null } | undefined;
    if (!file) return false;
    if (file.owner_type === "employee" && file.owner_id === employeeId) return true;
    const workspaceGroupId = `${orgId}:workspace`;
    const grant = this.db.prepare(`
      select id from file_access_grants
      where org_id = ? and file_id = ? and access_level in ('read', 'manage')
        and ((granted_to_type = 'employee' and granted_to_id = ?) or (granted_to_type = 'org_group' and granted_to_id = ?))
      limit 1
    `).get(orgId, fileId, employeeId, workspaceGroupId);
    return Boolean(grant);
  }

  private canReadSocialAccount(accountId: string, employeeId: string): boolean {
    const grant = this.db.prepare("select id from social_account_grants where social_account_id = ? and employee_id = ? limit 1").get(accountId, employeeId);
    return Boolean(grant);
  }

  private canReadScheduledPost(postId: string, employeeId: string): boolean {
    const row = this.db.prepare("select social_account_id from scheduled_posts where id = ?").get(postId) as { social_account_id: string } | undefined;
    return row ? this.canReadSocialAccount(row.social_account_id, employeeId) : false;
  }

  private assertEmployee(orgId: string, employeeId: string): void {
    const row = this.db.prepare("select id from employees where id = ? and org_id = ?").get(employeeId, orgId);
    if (!row) throw new Error("Search employee was not found.");
  }
}

function doc(entityType: SearchEntityType, entityId: string, title: string, body: string, facets: Record<string, string>): SearchDoc {
  return { entityType, entityId, title: title.trim(), body: body.trim(), facets };
}

function normalizeQuery(query: string): string {
  const terms = query.toLowerCase().match(/[a-z0-9_@.-]+/g) ?? [];
  return terms.map((term) => `${term.replaceAll('"', "")}*`).join(" AND ");
}

function validEntityTypes(entityTypes: SearchEntityType[]): Set<SearchEntityType> {
  const allowed = new Set<string>(SEARCH_ENTITY_TYPES);
  return new Set(entityTypes.filter((type) => allowed.has(type)));
}

function createTitle(value: string): string {
  const firstLine = value.split(/\r?\n/, 1)[0].trim();
  if (!firstLine) return "Untitled";
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

function preview(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

function parseFacets(value: string): Record<string, string> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Search facet payload is invalid.");
  return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, String(item)]));
}
