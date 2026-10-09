import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ChatService } from "../../src/main/services/chat-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { spaceHistory, threadHistory } from "../../src/main/services/chat-history";

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

describe("a conversation's history", () => {
  test("pages back from the earliest loaded message to the very first, beyond the recent window", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-space-history-${randomUUID()}.db`));
    const chat = new ChatService(connection.db);
    let orgId = "";
    connection.transaction(() => {
      orgId = new OrganizationService(connection.db).createOrganization({ organizationName: "Acme", employeeName: "Yang", mission: "m", goal: "g" });
    });
    const employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
    const spaceId = (connection.db.prepare("select id from chat_spaces where org_id = ? and name = 'general'").get(orgId) as { id: string }).id;
    const ids: string[] = [];
    for (let index = 0; index < 250; index += 1) {
      ids.push(connection.transaction(() => chat.sendMessage({
        orgId, spaceId, threadId: null, senderType: "employee", senderId: employeeId, bodyMd: `Line ${index}`, attachmentFileIds: [],
      })));
    }
    // Every message shares one instant, so only insertion order can page them correctly.
    connection.db.prepare("update chat_messages set created_at = '2026-03-01T00:00:00.000Z' where space_id = ?").run(spaceId);
    const first = spaceHistory(connection.db, orgId, spaceId, ids[200], { limit: 120 });
    expect(first.messages.map((message) => message.bodyMd)).toEqual(Array.from({ length: 120 }, (_, index) => `Line ${index + 80}`));
    expect(first.hasMore).toBe(true);
    const last = spaceHistory(connection.db, orgId, spaceId, first.messages[0].id, { limit: 120 });
    expect(last.messages.map((message) => message.bodyMd)).toEqual(Array.from({ length: 80 }, (_, index) => `Line ${index}`));
    expect(last.hasMore).toBe(false);
    // The loaded range refreshes in one query from its oldest message up to the cursor, edits included.
    connection.db.prepare("update chat_messages set body_md = 'Line 0 (edited)' where id = ?").run(ids[0]);
    const refreshed = spaceHistory(connection.db, orgId, spaceId, ids[200], { fromMessageId: ids[0] });
    expect(refreshed.messages.map((message) => message.bodyMd)).toEqual(["Line 0 (edited)", ...Array.from({ length: 199 }, (_, index) => `Line ${index + 1}`)]);
    expect(refreshed.hasMore).toBe(false);
    expect(spaceHistory(connection.db, orgId, spaceId, ids[200], { fromMessageId: ids[1] }).hasMore).toBe(true);
    // Each page carries the threads of its messages, which the snapshot may have dropped.
    expect(refreshed.threads.map((thread) => thread.rootMessageId).sort()).toEqual(ids.slice(0, 200).sort());
    // With nothing loaded, the newest messages come first.
    expect(spaceHistory(connection.db, orgId, spaceId, null, { limit: 2 }).messages.map((message) => message.bodyMd)).toEqual(["Line 248", "Line 249"]);
    expect(() => spaceHistory(connection.db, orgId, spaceId, "msg_elsewhere", { limit: 10 })).toThrow("The earliest loaded message is not in this conversation.");
    connection.close();
  }, 60_000);
});
