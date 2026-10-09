import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

const picked: { paths: string[] } = { paths: [] };
vi.mock("electron", () => ({ dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: picked.paths }) }, shell: {} }));

const { DatabaseConnection } = await import("../../src/main/database/connection");
const { OrganizationService } = await import("../../src/main/services/organization-service");
const { ChatService } = await import("../../src/main/services/chat-service");
const { FileService } = await import("../../src/main/services/file-service");

describe("delivering files in chat", () => {
  test("several files go in one message, and a message may be files alone", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-file-only-${randomUUID()}.db`));
    const chat = new ChatService(connection.db);
    let orgId = "";
    connection.transaction(() => {
      orgId = new OrganizationService(connection.db).createOrganization({ organizationName: "Acme", employeeName: "Yang", mission: "m", goal: "g" });
    });
    const employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
    const spaceId = (connection.db.prepare("select id from chat_spaces where org_id = ? and name = 'general'").get(orgId) as { id: string }).id;
    const source = join(tmpdir(), `ac-file-only-src-${randomUUID()}`);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "spec.md"), "The spec.");
    writeFileSync(join(source, "plan.md"), "The plan.");
    picked.paths = [join(source, "spec.md"), join(source, "missing.md"), join(source, "plan.md")];
    const imported = await new FileService(connection.db, join(tmpdir(), `ac-file-only-art-${randomUUID()}`)).importFile({ orgId, spaceId });
    // A file that cannot be imported is reported by name and does not drop the others.
    expect(imported.fileIds).toHaveLength(2);
    expect(imported.failures.map((failure) => failure.name)).toEqual(["missing.md"]);
    const fileIds = imported.fileIds;

    const send = (bodyMd: string, attachmentFileIds: string[]) => connection.transaction(() => chat.sendMessage({
      orgId, spaceId, threadId: null, senderType: "employee", senderId: employeeId, bodyMd, attachmentFileIds,
    }));
    const messageId = send("  ", fileIds);
    expect(connection.db.prepare("select count(*) as n from chat_attachments where message_id = ?").get(messageId)).toEqual({ n: 2 });
    expect(connection.db.prepare("select t.title from chat_threads t join chat_messages m on m.thread_id = t.id where m.id = ?").get(messageId))
      .toEqual({ title: "spec.md, plan.md" });
    expect(() => send("  ", [])).toThrow("A message needs text or a file.");
    connection.close();
  });
});
