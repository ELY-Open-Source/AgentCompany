import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { IPC_CHANNELS } from "../../src/shared/ipc";

// A record type nothing runs or shows is not kept: saving it would only claim it works.
test("automation rules are gone: no table, no channels", () => {
  const connection = new DatabaseConnection(join(tmpdir(), `agentcompany-new-${randomUUID()}.db`));
  const tables = connection.db.prepare("select name from sqlite_master where type = 'table'").all() as Array<{ name: string }>;
  connection.close();
  expect(tables.map((row) => row.name)).not.toContain("automation_rules");
  expect(Object.keys(IPC_CHANNELS).filter((key) => /automation/i.test(key))).toEqual([]);
});

test("meeting records are gone: no table, no channels", () => {
  const connection = new DatabaseConnection(join(tmpdir(), `agentcompany-new-${randomUUID()}.db`));
  const tables = connection.db.prepare("select name from sqlite_master where type = 'table'").all() as Array<{ name: string }>;
  connection.close();
  expect(tables.map((row) => row.name)).not.toContain("meetings");
  expect(Object.keys(IPC_CHANNELS).filter((key) => /meeting/i.test(key))).toEqual([]);
});
