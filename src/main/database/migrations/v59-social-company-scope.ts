import type { DatabaseSync } from "node:sqlite";
import { nowIso, tableExists } from "./types";

export const SOCIAL_COMPANY_SCOPE_SCHEMA_VERSION = 59;
export const SOCIAL_COMPANY_SCOPE_SCHEMA_NAME = "social_company_scope";

const TRIGGER_NAMES = [
  "trg_social_accounts_credential_secret_scope_insert",
  "trg_social_accounts_credential_secret_scope_update",
  "trg_browser_actions_social_account_scope_insert",
  "trg_browser_actions_social_account_scope_update",
] as const;

export function migrateSocialCompanyScopeV59(db: DatabaseSync): void {
  cleanupInvalidSocialAccountSecretRefs(db);
  cleanupInvalidBrowserActionRefs(db);
  installSocialCompanyScopeTriggers(db);
  db
    .prepare("insert or replace into schema_migrations (version, name, applied_at) values (?, ?, ?)")
    .run(SOCIAL_COMPANY_SCOPE_SCHEMA_VERSION, SOCIAL_COMPANY_SCOPE_SCHEMA_NAME, nowIso());
  assertSocialCompanyScopeV59(db);
}

export function assertSocialCompanyScopeV59(db: DatabaseSync): void {
  if (!tableExists(db, "social_accounts")) {
    throw new Error("Schema v59 drift: social_accounts table is missing.");
  }
  if (!tableExists(db, "secrets")) {
    throw new Error("Schema v59 drift: secrets table is missing.");
  }
  if (!tableExists(db, "browser_actions")) {
    throw new Error("Schema v59 drift: browser_actions table is missing.");
  }
  const invalid = db
    .prepare(
      `select count(*) as count
         from social_accounts sa
        where sa.credential_secret_id is not null
          and not exists (
            select 1
              from secrets s
             where s.id = sa.credential_secret_id
               and s.company_id = sa.company_id
          )`,
    )
    .get() as { count: number } | undefined;
  if ((invalid?.count ?? 0) > 0) {
    throw new Error("Schema v59 drift: social account credential secrets must belong to the same company.");
  }
  const invalidActions = db
    .prepare(
      `select count(*) as count
         from browser_actions ba
        where not exists (
          select 1
            from social_accounts sa
           where sa.id = ba.social_account_id
             and sa.company_id = ba.company_id
        )`,
    )
    .get() as { count: number } | undefined;
  if ((invalidActions?.count ?? 0) > 0) {
    throw new Error("Schema v59 drift: browser actions must reference social accounts in the same company.");
  }
  for (const triggerName of TRIGGER_NAMES) {
    if (!triggerExists(db, triggerName)) {
      throw new Error(`Schema v59 drift: ${triggerName} trigger is missing.`);
    }
  }
}

function cleanupInvalidSocialAccountSecretRefs(db: DatabaseSync): void {
  if (!tableExists(db, "social_accounts") || !tableExists(db, "secrets")) return;
  db
    .prepare(
      `update social_accounts
          set credential_secret_id = null,
              updated_at = ?
        where credential_secret_id is not null
          and not exists (
            select 1
              from secrets s
             where s.id = social_accounts.credential_secret_id
               and s.company_id = social_accounts.company_id
          )`,
    )
    .run(nowIso());
}

function cleanupInvalidBrowserActionRefs(db: DatabaseSync): void {
  if (!tableExists(db, "browser_actions") || !tableExists(db, "social_accounts")) return;
  db
    .prepare(
      `delete from browser_actions
        where not exists (
          select 1
            from social_accounts sa
           where sa.id = browser_actions.social_account_id
             and sa.company_id = browser_actions.company_id
        )`,
    )
    .run();
}

function installSocialCompanyScopeTriggers(db: DatabaseSync): void {
  for (const triggerName of TRIGGER_NAMES) {
    db.exec(`drop trigger if exists ${triggerName}`);
  }
  db.exec(`
    create trigger trg_social_accounts_credential_secret_scope_insert
    before insert on social_accounts
    when new.credential_secret_id is not null
      and not exists (
        select 1 from secrets
         where id = new.credential_secret_id
           and company_id = new.company_id
      )
    begin
      select raise(abort, 'social account credential secret must belong to the same company');
    end;

    create trigger trg_social_accounts_credential_secret_scope_update
    before update of credential_secret_id, company_id on social_accounts
    when new.credential_secret_id is not null
      and not exists (
        select 1 from secrets
         where id = new.credential_secret_id
           and company_id = new.company_id
      )
    begin
      select raise(abort, 'social account credential secret must belong to the same company');
    end;

    create trigger trg_browser_actions_social_account_scope_insert
    before insert on browser_actions
    when not exists (
      select 1 from social_accounts
       where id = new.social_account_id
         and company_id = new.company_id
    )
    begin
      select raise(abort, 'browser action social account must belong to the same company');
    end;

    create trigger trg_browser_actions_social_account_scope_update
    before update of social_account_id, company_id on browser_actions
    when not exists (
      select 1 from social_accounts
       where id = new.social_account_id
         and company_id = new.company_id
    )
    begin
      select raise(abort, 'browser action social account must belong to the same company');
    end;
  `);
}

function triggerExists(db: DatabaseSync, name: string): boolean {
  const row = db
    .prepare("select name from sqlite_master where type = 'trigger' and name = ? limit 1")
    .get(name) as { name: string } | undefined;
  return Boolean(row);
}
