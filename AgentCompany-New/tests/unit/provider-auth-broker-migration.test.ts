import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { providerAuthBrokerSchema } from "../../src/main/database/migrations/021-provider-auth-broker";

function createDatabase(): DatabaseSync {
  return new DatabaseSync(join(tmpdir(), `agentcompany-auth-broker-migration-${randomUUID()}.db`));
}

describe("provider auth broker migration", () => {
  test("backfills active auth profiles from configured credentials", () => {
    const db = createDatabase();
    db.exec(`
      create table schema_migrations(version integer primary key, name text not null, applied_at text not null);
      create table organizations(id text primary key);
      create table providers(
        id text primary key,
        org_id text not null,
        provider_key text not null,
        auth_type text not null,
        credential_id text
      );
      create table credentials(
        id text primary key,
        org_id text not null,
        provider_key text not null,
        kind text not null,
        ciphertext blob not null,
        display_hint text not null,
        created_at text not null
      );
      insert into schema_migrations(version, name, applied_at) values (20, 'rollback_snapshots', datetime('now'));
      insert into organizations(id) values ('org_1');
      insert into credentials(id, org_id, provider_key, kind, ciphertext, display_hint, created_at)
        values ('cred_1', 'org_1', 'openai', 'api_key', x'736563726574', 'sk-liv...ider', '2026-05-23T01:02:03.000Z');
      insert into providers(id, org_id, provider_key, auth_type, credential_id)
        values ('prov_1', 'org_1', 'openai', 'api_key', 'cred_1');
    `);

    db.exec(providerAuthBrokerSchema);

    const profile = db.prepare(`
      select org_id, provider_id, credential_id, provider_key, auth_type,
        profile_kind, display_hint, source_type, capability_json, active, created_at
      from provider_auth_profiles
    `).get() as {
      org_id: string;
      provider_id: string;
      credential_id: string;
      provider_key: string;
      auth_type: string;
      profile_kind: string;
      display_hint: string;
      source_type: string;
      capability_json: string;
      active: number;
      created_at: string;
    };
    const migration = db.prepare("select version, name from schema_migrations where version = 21").get();

    expect(profile).toMatchObject({
      org_id: "org_1",
      provider_id: "prov_1",
      credential_id: "cred_1",
      provider_key: "openai",
      auth_type: "api_key",
      profile_kind: "api_key",
      display_hint: "sk-liv...ider",
      source_type: "migrated_credential",
      active: 1,
      created_at: "2026-05-23T01:02:03.000Z",
    });
    expect(JSON.parse(profile.capability_json)).toEqual({ providerKey: "openai", authType: "api_key", capabilityTags: [] });
    expect(migration).toEqual({ version: 21, name: "provider_auth_broker" });
    db.close();
  });
});
