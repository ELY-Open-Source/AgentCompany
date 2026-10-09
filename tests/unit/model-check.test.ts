import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import type { AgentTurnResult, ProviderToolTurnInput } from "../../src/main/services/provider-tool-turn";
import { answeringModelCheck } from "../helpers/model-check";
import { PROVIDER_DATA_POLICY } from "../../src/shared/domain";
import { PROVIDER_MONTHLY_LIMIT_MESSAGE } from "../../src/shared/provider-runtime-domain";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

const WORK = { workspaceId: null, instructions: "Do the work.", messages: [{ role: "user" as const, text: "go" }], tools: [] };
const TEXT_ONLY = async (): Promise<AgentTurnResult> => ({ text: "Sure, the code is 123.", toolCalls: [], rawResponseJson: "{}" });

function harness(turn: (input: ProviderToolTurnInput) => Promise<AgentTurnResult>) {
  const connection = new DatabaseConnection(join(tmpdir(), `ac-model-check-${randomUUID()}.db`));
  const providers = new ProviderService(connection.db, providerAdapters, testVault, turn);
  let orgId = "";
  let providerId = "";
  connection.transaction(() => {
    orgId = new OrganizationService(connection.db).createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
    providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
    providers.saveCredential({ orgId, providerId, secret: "sk-test", model: "gpt-5.4" });
  });
  const requests = () => (connection.db.prepare("select count(*) as n from provider_requests").get() as { n: number }).n;
  return { connection, providers, orgId, providerId, requests };
}

describe("a model is checked for agent work before it does any", () => {
  test("a model that answers in text instead of calling tools is refused, and the verdict is kept", async () => {
    const h = harness(TEXT_ONLY);
    await expect(h.providers.runToolTurn({ purpose: "agent_turn", orgId: h.orgId, providerId: h.providerId, ...WORK }))
      .rejects.toThrow("gpt-5.4 on openai failed the agent check: it answered in text instead of calling the tool it was given");
    expect(h.requests()).toBe(1);
    await expect(h.providers.runToolTurn({ purpose: "agent_turn", orgId: h.orgId, providerId: h.providerId, ...WORK })).rejects.toThrow("failed the agent check");
    expect(h.requests()).toBe(1);
    h.connection.close();
  });

  test("a capable model is probed once, then works; the probe is a request like any other and counts against the quota", async () => {
    const seen: ProviderToolTurnInput[] = [];
    const h = harness(answeringModelCheck(async (input) => { seen.push(input); return { text: "Done.", toolCalls: [], rawResponseJson: "{}" }; }));
    expect((await h.providers.runToolTurn({ purpose: "agent_turn", orgId: h.orgId, providerId: h.providerId, ...WORK })).text).toBe("Done.");
    expect((await h.providers.runToolTurn({ purpose: "agent_turn", orgId: h.orgId, providerId: h.providerId, ...WORK })).text).toBe("Done.");
    expect([h.requests(), seen.length]).toEqual([3, 2]);

    const tight = harness(answeringModelCheck(async () => ({ text: "Done.", toolCalls: [], rawResponseJson: "{}" })));
    tight.providers.updatePolicy({ orgId: tight.orgId, providerId: tight.providerId, dataPolicy: PROVIDER_DATA_POLICY.STANDARD, backgroundEnabled: false, monthlyRequestLimit: 1, workspaceScope: "organization", contextWindowTokens: 128_000 });
    await expect(tight.providers.runToolTurn({ purpose: "agent_turn", orgId: tight.orgId, providerId: tight.providerId, ...WORK })).rejects.toThrow(PROVIDER_MONTHLY_LIMIT_MESSAGE);
    expect(tight.requests()).toBe(1);
    h.connection.close();
    tight.connection.close();
  });

  test("a probe whose request fails records nothing; a new model gets its own probe; Settings can check again", async () => {
    let mode: "down" | "text" | "capable" = "down";
    const capable: (input: ProviderToolTurnInput) => Promise<AgentTurnResult> = answeringModelCheck(async () => ({ text: "ok", toolCalls: [], rawResponseJson: "{}" }));
    const h = harness(async (input) => {
      if (mode === "down") throw new Error("connect ECONNREFUSED");
      return mode === "text" ? TEXT_ONLY() : capable(input);
    });
    await expect(h.providers.runToolTurn({ purpose: "agent_turn", orgId: h.orgId, providerId: h.providerId, ...WORK })).rejects.toThrow("ECONNREFUSED");
    expect(h.connection.db.prepare("select count(*) as n from model_checks").get()).toEqual({ n: 0 });

    mode = "text";
    expect(await h.providers.checkModel({ orgId: h.orgId, providerId: h.providerId, model: "gpt-5.4" }))
      .toEqual({ passed: false, detail: "it answered in text instead of calling the tool it was given" });
    mode = "capable";
    expect(await h.providers.checkModel({ orgId: h.orgId, providerId: h.providerId, model: "gpt-5.4" })).toEqual({ passed: true });
    expect((await h.providers.runToolTurn({ purpose: "agent_turn", orgId: h.orgId, providerId: h.providerId, ...WORK })).text).toBe("ok");

    h.connection.db.prepare("update providers set model = 'gpt-5.5' where id = ?").run(h.providerId);
    mode = "text";
    await expect(h.providers.runToolTurn({ purpose: "agent_turn", orgId: h.orgId, providerId: h.providerId, ...WORK })).rejects.toThrow("gpt-5.5 on openai failed the agent check");
    h.connection.close();
  });
});
