import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { IPC_CHANNELS } from "../../src/shared/ipc";

function createConnection(): DatabaseConnection {
  return new DatabaseConnection(join(tmpdir(), `agentcompany-new-audit-${randomUUID()}.db`));
}

describe("audit service", () => {
  test("keeps core audit events immutable", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    let auditId = "";

    connection.transaction(() => {
      const orgId = organization.createOrganization({
        organizationName: "Acme Operations",
        employeeName: "Dana Lee",
        mission: "Coordinate agents with auditable approvals.",
        goal: "Ship a verified control plane.",
      });
      auditId = (connection.db.prepare("select id from audit_events where org_id = ? limit 1").get(orgId) as { id: string }).id;
    });

    expect(() => connection.db.prepare("update audit_events set action = ? where id = ?")
      .run("changed", auditId)).toThrow("Audit events are immutable.");
    expect(() => connection.db.prepare("delete from audit_events where id = ?")
      .run(auditId)).toThrow("Audit events are immutable.");
    connection.close();
  });

  test("offers no thread replay that only digests events and reconstructs nothing", () => {
    const connection = createConnection();
    expect(connection.db.prepare("select name from sqlite_master where type = 'table' and name = 'audit_replay_runs'").all()).toEqual([]);
    expect(Object.keys(IPC_CHANNELS)).not.toContain("createAuditReplay");
    connection.close();
  });
});
