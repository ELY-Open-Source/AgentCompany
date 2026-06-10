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
  test("orphaned running runs fail at boot and the heartbeat re-enqueues the task", () => {
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
    const insertRequest = (id: string, executionMode: string, state: string) => {
      connection.db.prepare(`
        insert into provider_requests(
          id, org_id, provider_id, provider_key, workspace_id, model, prompt_sha256,
          response_text, raw_response_json, state, error_message, input_char_count,
          output_char_count, execution_mode, policy_decision, external_response_id,
          stream_event_count, cancelled_at, created_at, completed_at
        )
        values (?, ?, ?, 'openai', null, 'gpt-5.1', 'sha', null, null, ?, null, 10, 0, ?, 'allowed', ?, 0, null, ?, null)
      `).run(id, orgId, providerId, state, executionMode, executionMode === "background" ? "resp_ext" : null, new Date().toISOString());
    };
    const foregroundId = createId("preq");
    const backgroundId = createId("preq");
    insertRequest(foregroundId, "foreground", "pending");
    insertRequest(backgroundId, "background", "pending");

    connection.transaction(() => recoverInterruptedWork(connection.db));

    const run = connection.db.prepare("select state, error_message, completed_at from task_runs where id = ?")
      .get(claimed!.id) as { state: string; error_message: string; completed_at: string };
    expect(run.state).toBe("failed");
    expect(run.error_message).toContain("Interrupted");
    expect(run.completed_at).toBeTruthy();

    // Foreground orphans fail; background ones stay for the background worker.
    expect(connection.db.prepare("select state from provider_requests where id = ?").get(foregroundId)).toMatchObject({ state: "failed" });
    expect(connection.db.prepare("select state from provider_requests where id = ?").get(backgroundId)).toMatchObject({ state: "pending" });

    // The interruption is auditable and the heartbeat immediately retries the task.
    const audit = connection.db.prepare(
      "select count(*) as n from audit_events where org_id = ? and entity_type = 'task_run' and action = 'failed'",
    ).get(orgId) as { n: number };
    expect(audit.n).toBe(1);
    const taskExecution = new TaskExecutionService(connection.db);
    const enqueued = connection.transaction(() => taskExecution.enqueueHeartbeatRuns());
    expect(enqueued).toHaveLength(1);

    // Recovery is idempotent: a second boot changes nothing.
    connection.transaction(() => recoverInterruptedWork(connection.db));
    const failedRuns = connection.db.prepare("select count(*) as n from task_runs where state = 'failed'").get() as { n: number };
    expect(failedRuns.n).toBe(1);
    connection.close();
  });
});
