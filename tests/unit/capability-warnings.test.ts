import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";

vi.mock("electron", () => ({
  net: {
    request: () => {
      const request = new EventEmitter() as EventEmitter & { setHeader: () => void; write: () => void; end: () => void; abort: () => void };
      request.setHeader = () => undefined;
      request.write = () => undefined;
      request.abort = () => undefined;
      request.end = () => {
        const response = new EventEmitter() as EventEmitter & { statusCode: number };
        response.statusCode = 503;
        request.emit("response", response);
        response.emit("data", Buffer.from(JSON.stringify({ error: "Service Unavailable", detail: "busy" }, null, 2)));
        response.emit("end");
      };
      return request;
    },
  },
}));

const { DatabaseConnection } = await import("../../src/main/database/connection");
const { OnboardingService } = await import("../../src/main/services/onboarding-service");
const { ProviderService } = await import("../../src/main/services/provider-service");
const { providerAdapters } = await import("../../src/main/services/provider-adapters");
const { IntegrationKeyStore } = await import("../../src/main/services/integration-key-store");
const { claimNextQueuedRun } = await import("../../src/main/app/task-queue-worker");
const { executeComposioTool } = await import("../../src/main/services/composio/composio-tool-bridge");
const { withRunControl } = await import("../../src/main/services/run-control");

const vault = { encryptSecret: (secret: string) => Buffer.from(secret, "utf8"), decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8") };

describe("a run tells the user which capabilities it lacked", () => {
  test("a connector whose actions cannot be listed is named on the run, as well as told to the agent", async () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-capability-${randomUUID()}.db`));
    const providers = new ProviderService(connection.db, providerAdapters, vault);
    const onboarding = new OnboardingService({ db: connection.db, saveProviderCredential: (input) => providers.saveCredential(input) });
    let orgId = "";
    let ceoId = "";
    connection.transaction(() => {
      const summary = onboarding.bootstrap({
        companyName: "FlowPilot", companyDescription: "d", employeeName: "Yang", workspacePath: "", executionMode: "ai_ceo", autoApproveHires: true,
        reviewDeliverables: false, goalTitle: "Ship.", goalDescription: "d", providerKey: "openai", providerSecret: "sk-test", providerModel: "gpt-5.4",
      });
      orgId = summary.orgId;
      ceoId = summary.ceoAgentId;
      const now = new Date().toISOString();
      connection.db.prepare("insert into connector_accounts(id, org_id, toolkit_slug, toolkit_name, auth_config_id, status, created_at, updated_at) values ('ca_gh', ?, 'github', 'GitHub', 'ac_gh', 'ACTIVE', ?, ?)").run(orgId, now, now);
    });
    const keys = new IntegrationKeyStore(connection.db, vault);
    keys.write("composio", "ak_capability");
    const run = claimNextQueuedRun(connection)!;
    const output = await withRunControl(run.id, () => executeComposioTool(connection.db, keys, orgId, ceoId, { id: "c1", name: "composio_find_actions", arguments: { query: "create pull request" } }), 60_000);
    expect(output).toMatch(/^ERROR: .*503/);
    const warnings = (connection.db.prepare("select capability_warnings from task_runs where id = ?").get(run.id) as { capability_warnings: string }).capability_warnings;
    expect(warnings).toMatch(/^The actions of github could not be listed: .*503/);
    expect(warnings.split("\n")).toHaveLength(1);
    await withRunControl(run.id, () => executeComposioTool(connection.db, keys, orgId, ceoId, { id: "c2", name: "composio_find_actions", arguments: { query: "again" } }), 60_000);
    expect((connection.db.prepare("select capability_warnings from task_runs where id = ?").get(run.id) as { capability_warnings: string }).capability_warnings).toBe(warnings);
    connection.close();
  });
});
