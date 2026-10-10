import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { IntegrationKeyStore } from "../../src/main/services/integration-key-store";
import type { IntegrationKeyName } from "../../src/shared/commands";

const reversingVault = {
  encryptSecret: (secret: string) => Buffer.from([...secret].reverse().join(""), "utf8"),
  decryptSecret: (ciphertext: Buffer) => [...ciphertext.toString("utf8")].reverse().join(""),
};

function openStore() {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-keys-${randomUUID()}.db`));
  return { connection, store: new IntegrationKeyStore(connection.db, reversingVault) };
}

describe("integration key store", () => {
  test("saves trimmed keys through the vault and reads them back", () => {
    const { connection, store } = openStore();
    store.write("composio", "  ak_123  ");
    const row = connection.db.prepare("select ciphertext from integration_keys where name = 'composio'").get() as { ciphertext: Uint8Array };
    expect(Buffer.from(row.ciphertext).toString("utf8")).toBe("321_ka");
    expect(store.read("composio")).toBe("ak_123");
    expect(store.read("logo_dev")).toBeNull();
    connection.close();
  });

  test("statuses list every known key in order with configured flags", () => {
    const { connection, store } = openStore();
    store.write("logo_dev", "pk_1");
    const statuses = store.statuses();
    expect(statuses.map((status) => [status.name, status.configured])).toEqual([
      ["composio", false],
      ["logo_dev", true],
    ]);
    expect(statuses[1].updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    connection.close();
  });

  test("clear removes a key and overwrite replaces it", () => {
    const { connection, store } = openStore();
    store.write("composio", "ak_old");
    store.write("composio", "ak_new");
    expect(store.read("composio")).toBe("ak_new");
    store.clear("composio");
    expect(store.read("composio")).toBeNull();
    connection.close();
  });

  test("rejects blank values and unknown names", () => {
    const { connection, store } = openStore();
    expect(() => store.write("composio", "   ")).toThrow("cannot be blank");
    expect(() => store.write("stripe" as IntegrationKeyName, "x")).toThrow('Unknown integration key "stripe"');
    connection.close();
  });
});
