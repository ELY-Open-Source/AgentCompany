// Search re-indexes only what changed: triggers queue each changed record (a plain insert, since an outer statement's conflict policy overrides one inside a trigger), and a company's index is built in full once.
const INDEXED: Array<[table: string, entityType: string]> = [
  ["employees", "employee"],
  ["agents", "agent"],
  ["tasks", "task"],
  ["projects", "project"],
  ["goals", "goal"],
  ["workspaces", "workspace"],
  ["approvals", "approval"],
  ["chat_spaces", "chat_space"],
  ["chat_messages", "chat_message"],
  ["file_objects", "file"],
  ["providers", "provider"],
  ["documents", "document"],
  ["knowledge_entries", "knowledge"],
];

const triggers = INDEXED.map(([table, entityType]) => ["insert", "update", "delete"].map((event) => {
  const row = event === "delete" ? "old" : "new";
  return `
  create trigger if not exists search_pending_${table}_${event} after ${event} on ${table}
  begin
    insert into search_pending(org_id, entity_type, entity_id)
    select ${row}.org_id, '${entityType}', ${row}.id
    where not exists (select 1 from search_pending where entity_type = '${entityType}' and entity_id = ${row}.id);
  end;`;
}).join("")).join("");

export const searchPendingSchema = `
  create table if not exists search_pending (
    org_id text not null,
    entity_type text not null,
    entity_id text not null,
    primary key (entity_type, entity_id)
  );
  create table if not exists search_built (org_id text primary key);
  ${triggers}

  create trigger if not exists search_cleanup_organization after delete on organizations
  begin
    delete from search_documents where org_id = old.id;
    delete from search_pending where org_id = old.id;
    delete from search_built where org_id = old.id;
  end;

  insert into schema_migrations(version, name, applied_at)
  values (107, 'search_pending', datetime('now'));
`;
