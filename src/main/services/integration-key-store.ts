import type { DatabaseSync } from "node:sqlite";
import {
  INTEGRATION_KEY_NAMES,
  type IntegrationKeyName,
  type IntegrationKeyStatus,
} from "../../shared/commands";
import type { ProviderSecretVault } from "./auth-broker-service";
import { SecretVault } from "./secret-vault";

/** Operator-entered third-party keys, encrypted. */
export class IntegrationKeyStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly vault: ProviderSecretVault = new SecretVault(),
  ) {}

  read(name: IntegrationKeyName): string | null {
    const row = this.db.prepare("select ciphertext from integration_keys where name = ?")
      .get(name) as { ciphertext: Uint8Array } | undefined;
    return row ? this.vault.decryptSecret(Buffer.from(row.ciphertext)) : null;
  }

  write(name: IntegrationKeyName, value: string): void {
    requireKnownName(name);
    const key = value.trim();
    if (!key) throw new Error(`The ${name} key cannot be blank.`);
    this.db.prepare(`
      insert into integration_keys(name, ciphertext, updated_at) values (?, ?, ?)
      on conflict(name) do update set ciphertext = excluded.ciphertext, updated_at = excluded.updated_at
    `).run(name, this.vault.encryptSecret(key), new Date().toISOString());
    console.info(`[integration-keys] ${name} saved`);
  }

  clear(name: IntegrationKeyName): void {
    requireKnownName(name);
    this.db.prepare("delete from integration_keys where name = ?").run(name);
    console.info(`[integration-keys] ${name} cleared`);
  }

  statuses(): IntegrationKeyStatus[] {
    const rows = this.db.prepare("select name, updated_at from integration_keys")
      .all() as Array<{ name: string; updated_at: string }>;
    const saved = new Map(rows.map((row) => [row.name, row.updated_at]));
    return INTEGRATION_KEY_NAMES.map((name) => ({
      name,
      configured: saved.has(name),
      updatedAt: saved.get(name) ?? null,
    }));
  }
}

function requireKnownName(name: string): asserts name is IntegrationKeyName {
  if (!(INTEGRATION_KEY_NAMES as readonly string[]).includes(name)) {
    throw new Error(`Unknown integration key "${name}".`);
  }
}
