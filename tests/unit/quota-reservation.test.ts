import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { PROVIDER_MONTHLY_LIMIT_MESSAGE } from "../../src/shared/provider-runtime-domain";
import { PROVIDER_DATA_POLICY } from "../../src/shared/domain";
import type { AgentTurnResult } from "../../src/main/services/provider-tool-turn";
import { markModelChecked } from "../helpers/model-check";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

describe("monthly quota reservation", () => {
  test("with one request left, concurrent calls cannot both take it", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started = 0;
    const turn = async (): Promise<AgentTurnResult> => {
      started += 1;
      await gate;
      return { text: "done", toolCalls: [], rawResponseJson: "{}" };
    };
    const connection = new DatabaseConnection(join(tmpdir(), `ac-quota-${randomUUID()}.db`));
    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, turn);
    let orgId = "";
    let providerId = "";
    connection.transaction(() => {
      orgId = new OrganizationService(connection.db).createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      providers.saveCredential({ orgId, providerId, secret: "sk-test", model: "gpt-5.4" });
      markModelChecked(connection.db, providerId, "gpt-5.4");
      providers.updatePolicy({ orgId, providerId, dataPolicy: PROVIDER_DATA_POLICY.STANDARD, backgroundEnabled: false, monthlyRequestLimit: 1, workspaceScope: "organization", contextWindowTokens: 128_000 });
    });
    const call = () => providers.runToolTurn({ orgId, providerId, workspaceId: null, instructions: "i", messages: [{ role: "user", text: "u" }], tools: [] });
    const first = call();
    const second = call();
    await expect(second).rejects.toThrow(PROVIDER_MONTHLY_LIMIT_MESSAGE);
    release();
    await first;
    expect(started).toBe(1);
    await expect(call()).rejects.toThrow(PROVIDER_MONTHLY_LIMIT_MESSAGE);
    connection.close();
  });
});
