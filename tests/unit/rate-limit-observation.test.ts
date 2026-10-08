import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OrganizationService } from "../../src/main/services/organization-service";
import { ProviderService } from "../../src/main/services/provider-service";
import { providerAdapters } from "../../src/main/services/provider-adapters";
import { TaskExecutionService } from "../../src/main/services/task-execution-service";
import { RISK_LEVEL, TASK_PRIORITY, TASK_STATUS } from "../../src/shared/domain";
import type { AgentTurnResult } from "../../src/main/services/provider-tool-turn";
import { claimNextQueuedRun } from "../../src/main/app/task-queue-worker";

const testVault = {
  encryptSecret: (secret: string) => Buffer.from(secret, "utf8"),
  decryptSecret: (ciphertext: Buffer) => ciphertext.toString("utf8"),
};

describe("rate limits seen on successful calls", () => {
  test("a successful agent call records the provider's remaining quota, and an exhausted provider's work waits for its reset", async () => {
    const resetAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const turn = async (): Promise<AgentTurnResult> => ({
      text: "done", toolCalls: [], rawResponseJson: "{}",
      rateLimitState: { requestLimit: 50, remainingRequests: 0, resetAt, retryAfterMs: null, rawStateJson: "{}" },
    });
    const connection = new DatabaseConnection(join(tmpdir(), `ac-ratelimit-${randomUUID()}.db`));
    const organization = new OrganizationService(connection.db);
    const providers = new ProviderService(connection.db, providerAdapters, testVault, undefined, turn);
    const execution = new TaskExecutionService(connection.db, providers);
    let orgId = "";
    let providerId = "";
    connection.transaction(() => {
      orgId = organization.createOrganization({ organizationName: "Acme", employeeName: "Dana", mission: "m", goal: "g" });
      providerId = (connection.db.prepare("select id from providers where org_id = ? and provider_key = 'openai'").get(orgId) as { id: string }).id;
      providers.saveCredential({ orgId, providerId, secret: "sk-test", model: "gpt-5.4" });
      const agentId = organization.createAgent({ orgId, name: "Ada", role: "Engineer", department: "Engineering", modelProviderId: providerId, modelId: "gpt-5.4", budgetCents: 1000, managerAgentId: null, heartbeatEnabled: true });
      organization.createTask({ orgId, title: "Work", description: "d", status: TASK_STATUS.BACKLOG, assigneeAgentId: agentId, risk: RISK_LEVEL.LOW, projectId: null, goalId: null, workspaceId: null, priority: TASK_PRIORITY.NORMAL, requiresFilesystem: false });
    });
    // The first session's response says no requests remain: it is recorded, and the provider is parked until the reset.
    const [first] = connection.transaction(() => execution.enqueueHeartbeatRuns());
    connection.db.prepare("update task_runs set state = 'running' where id = ?").run(first);
    await execution.executeRun(orgId, first);
    expect(connection.db.prepare("select request_limit, remaining_requests, reset_at from provider_rate_limit_observations where provider_id = ?").get(providerId))
      .toEqual({ request_limit: 50, remaining_requests: 0, reset_at: resetAt });
    expect(execution.cooledProviderIds()).toEqual([providerId]);
    expect(claimNextQueuedRun(connection, execution.cooledProviderIds())).toBeNull();
    connection.close();
  });
});
