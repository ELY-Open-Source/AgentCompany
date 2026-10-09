import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";

describe("read state", () => {
  test("marks read up to the message the reader saw, never past it and never backwards", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-read-state-${randomUUID()}.db`));
    const chat = new ChatService(connection.db);
    let orgId = "";
    connection.transaction(() => {
      orgId = new OrganizationService(connection.db).createOrganization({ organizationName: "Acme", employeeName: "Yang", mission: "m", goal: "g" });
    });
    const employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
    const space = (name: string) => (connection.db.prepare("select id from chat_spaces where org_id = ? and name = ?").get(orgId, name) as { id: string }).id;
    const general = space("general");
    const send = (spaceId: string, bodyMd: string) => connection.transaction(() => chat.sendMessage({
      orgId, spaceId, threadId: null, senderType: "employee", senderId: employeeId, bodyMd, attachmentFileIds: [],
    }));
    const createdAt = (id: string) => (connection.db.prepare("select created_at from chat_messages where id = ?").get(id) as { created_at: string }).created_at;
    const readState = () => connection.db.prepare("select last_read_message_id as id, last_read_at as at from chat_read_state where space_id = ?").get(general);
    const seen = send(general, "Seen");
    const later = send(general, "Arrived while scrolled up");
    connection.db.prepare("update chat_messages set created_at = ? where id = ?").run("2099-01-01T00:00:00.000Z", later);

    chat.markSpaceRead({ orgId, employeeId, spaceId: general, upToMessageId: seen });
    expect(readState()).toEqual({ id: seen, at: createdAt(seen) });
    chat.markSpaceRead({ orgId, employeeId, spaceId: general, upToMessageId: later });
    chat.markSpaceRead({ orgId, employeeId, spaceId: general, upToMessageId: seen });
    expect(readState()).toEqual({ id: later, at: "2099-01-01T00:00:00.000Z" });
    // Two messages in the same millisecond still order by insertion, so reading the second advances.
    const first = send(general, "Same instant one");
    const second = send(general, "Same instant two");
    connection.db.prepare("update chat_messages set created_at = '2099-06-01T00:00:00.000Z' where id in (?, ?)").run(first, second);
    chat.markSpaceRead({ orgId, employeeId, spaceId: general, upToMessageId: first });
    chat.markSpaceRead({ orgId, employeeId, spaceId: general, upToMessageId: second });
    expect(readState()).toEqual({ id: second, at: "2099-06-01T00:00:00.000Z" });
    chat.markSpaceRead({ orgId, employeeId, spaceId: general, upToMessageId: first });
    expect(readState()).toEqual({ id: second, at: "2099-06-01T00:00:00.000Z" });
    expect(() => chat.markSpaceRead({ orgId, employeeId, spaceId: general, upToMessageId: send(space("engineering"), "Elsewhere") }))
      .toThrow("The message read is not in this conversation.");
    connection.close();
  });
});
