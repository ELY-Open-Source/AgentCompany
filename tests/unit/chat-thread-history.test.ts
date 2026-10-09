import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { threadHistory } from "../../src/main/services/chat-history";

describe("a thread's history", () => {
  test("holds the whole thread even after newer traffic pushed it out of the recent window", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-thread-history-${randomUUID()}.db`));
    const chat = new ChatService(connection.db);
    let orgId = "";
    connection.transaction(() => {
      orgId = new OrganizationService(connection.db).createOrganization({ organizationName: "Acme", employeeName: "Yang", mission: "m", goal: "g" });
    });
    const employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
    const spaceId = (connection.db.prepare("select id from chat_spaces where org_id = ? and name = 'general'").get(orgId) as { id: string }).id;
    const send = (bodyMd: string, threadId: string | null) => connection.transaction(() => chat.sendMessage({
      orgId, spaceId, threadId, senderType: "employee", senderId: employeeId, bodyMd, attachmentFileIds: [],
    }));
    const rootId = send("Root question", null);
    const threadId = (connection.db.prepare("select thread_id from chat_messages where id = ?").get(rootId) as { thread_id: string }).thread_id;
    send("First answer", threadId);
    for (let index = 0; index < 500; index += 1) send(`Filler ${index}`, null);
    send("Late answer", threadId);

    const snapshot = new SnapshotService(connection.db).load();
    expect(snapshot.chatMessages.some((message) => message.id === rootId)).toBe(false);
    // The thread of every loaded message is in the snapshot, however many threads are newer.
    const loadedThreads = new Set(snapshot.chatThreads.map((thread) => thread.id));
    expect(snapshot.chatMessages.filter((message) => message.threadId && !loadedThreads.has(message.threadId))).toEqual([]);
    expect(threadHistory(connection.db, orgId, threadId).messages.map((message) => message.bodyMd)).toEqual(["Root question", "First answer", "Late answer"]);
    expect(() => threadHistory(connection.db, orgId, "thread_missing")).toThrow("Chat thread was not found.");
    connection.close();
  }, 60_000);
});
