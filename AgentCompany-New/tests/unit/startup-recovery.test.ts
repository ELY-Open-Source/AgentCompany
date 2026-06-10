import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { OnboardingService } from "../../src/main/services/onboarding-service";
import { TaskExecutionService } from "../../src/main/services/task-execution-service";
import { claimNextQueuedRun } from "../../src/main/app/task-queue-worker";
import { recoverInterruptedWork } from "../../src/main/app/startup-recovery";
import { createId } from "../../src/shared/ids";

describe("startup recovery", () => {
  test("orphaned running runs return to the queue at boot without spending retry budget", () => {
    const connection = new DatabaseConnection(join(tmpdir(), `ac-recover-${randomUUID()}.db`));
    const onboarding = new OnboardingService({
      db: connection.db,
      saveProviderCredential: ({ orgId, providerId, model }) => {
        connection.db.prepare("update providers set credential_id = ?, model = ?, enabled = 1 where id = ? and org_id = ?")
          .run("cred_test", model, providerId, orgId);
      },
    });

    let orgId = "";
    let providerId = "";
    connection.transaction(() => {
      const summary = onboarding.bootstrap({
        companyName: "Acme Operations",
        companyDescription: "Coordinate agents with auditable approvals.",
        employeeName: "Dana Lee",
        workspacePath: "",
        executionMode: "ai_ceo",
        autoApproveHires: true,
        reviewDeliverables: false,
        goalTitle: "Ship a verified control plane",
        goalDescription: "Bring the desktop operating loop online.",
        providerKey: "openai",
        providerSecret: "test-secret",
        providerModel: "gpt-5.1",
      });
      orgId = summary.orgId;
      providerId = summary.providerId;
    });

    // The previous session claimed the run and left in-flight provider requests.
    const claimed = claimNextQueuedRun(connection);
    expect(claimed).toBeTruthy();
    const insertRequest = (id: string, executionMode: string, externalResponseId: string | null) => {
      connection.db.prepare(`
        insert into provider_requests(
          id, org_id, provider_id, provider_key, workspace_id, model, prompt_sha256,
          response_text, raw_response_json, state, error_message, input_char_count,
          output_char_count, execution_mode, policy_decision, external_response_id,
          stream_event_count, cancelled_at, created_at, completed_at
        )
        values (?, ?, ?, 'openai', null, 'gpt-5.1', 'sha', null, null, 'pending', null, 10, 0, ?, 'allowed', ?, 0, null, ?, null)
      `).run(id, orgId, providerId, executionMode, externalResponseId, new Date().toISOString());
    };
    const foregroundId = createId("preq");
    const acceptedBackgroundId = createId("preq");
    const unacceptedBackgroundId = createId("preq");
    insertRequest(foregroundId, "foreground", null);
    insertRequest(acceptedBackgroundId, "background", "resp_ext");
    insertRequest(unacceptedBackgroundId, "background", null);

    connection.transaction(() => recoverInterruptedWork(connection.db));

    // Interruption is not failure: the run returns to the queue and is claimed again.
    const run = connection.db.prepare("select state, started_at, error_message from task_runs where id = ?")
      .get(claimed!.id) as { state: string; started_at: string | null; error_message: string | null };
    expect(run).toMatchObject({ state: "queued", started_at: null, error_message: null });
    const audit = connection.db.prepare(
      "select count(*) as n from audit_events where org_id = ? and entity_type = 'task_run' and action = 'requeued'",
    ).get(orgId) as { n: number };
    expect(audit.n).toBe(1);
    const reclaimed = claimNextQueuedRun(connection);
    expect(reclaimed?.id).toBe(claimed!.id);

    // The heartbeat does not double-enqueue the task while its run is live.
    const taskExecution = new TaskExecutionService(connection.db);
    expect(connection.transaction(() => taskExecution.enqueueHeartbeatRuns())).toEqual([]);

    // Dead in-flight requests fail unless the background worker can resume them by external id.
    expect(connection.db.prepare("select state from provider_requests where id = ?").get(foregroundId)).toMatchObject({ state: "failed" });
    expect(connection.db.prepare("select state from provider_requests where id = ?").get(acceptedBackgroundId)).toMatchObject({ state: "pending" });
    expect(connection.db.prepare("select state from provider_requests where id = ?").get(unacceptedBackgroundId)).toMatchObject({ state: "failed" });

    // Recovery is idempotent for runs it already requeued and claimed work it does not own.
    connection.transaction(() => recoverInterruptedWork(connection.db));
    const requeues = connection.db.prepare(
      "select count(*) as n from audit_events where org_id = ? and entity_type = 'task_run' and action = 'requeued'",
    ).get(orgId) as { n: number };
    expect(requeues.n).toBe(2);
    connection.close();
  });
});
