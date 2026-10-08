import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import type { AgentTurnResult, ToolDefinition } from "../../src/main/services/provider-tool-turn";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

describe("character accounting", () => {
  test("a tool turn counts instructions, conversation and tool definitions in, and text plus tool calls out", async () => {
    const toolCalls = [{ id: "c1", name: "send_message", arguments: { channel: "general", body: "Shipping today." } }];
    const turn = async (): Promise<AgentTurnResult> => ({ text: "Posting.", toolCalls, rawResponseJson: "{}" });
    const connection = new DatabaseConnection(join(tmpdir(), `ac-chars-${randomUUID()}.db`));
    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, turn);
    let orgId = "";
    let providerId = "";
    connection.transaction(() => {
      orgId = new OrganizationService(connection.db).createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      providers.saveCredential({ orgId, providerId, secret: "sk-test", model: "gpt-5.4" });
    });
    const instructions = "You run this company.";
    const messages = [{ role: "user" as const, text: "Kick off the launch." }];
    const tools: ToolDefinition[] = [{ name: "send_message", description: "Post a message.", parameters: { type: "object", properties: {} } }];
    const result = await providers.runToolTurn({ orgId, providerId, workspaceId: null, instructions, messages, tools });

    expect(connection.db.prepare("select input_char_count, output_char_count from provider_requests where id = ?").get(result.requestId)).toEqual({
      input_char_count: instructions.length + JSON.stringify(messages).length + JSON.stringify(tools).length,
      output_char_count: "Posting.".length + JSON.stringify(toolCalls).length,
    });
    connection.close();
  });
});
