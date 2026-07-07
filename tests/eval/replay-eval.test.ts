import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DatabaseConnection } from "../../src/main/database/connection";
import { AuditService } from "../../src/main/services/audit-service";
import { ChatService } from "../../src/main/services/chat-service";
import { OperationsService } from "../../src/main/services/operations-service";
import { OrganizationService } from "../../src/main/services/organization-service";
import { SdlcService } from "../../src/main/services/sdlc-service";
import { SnapshotService } from "../../src/main/services/snapshot-service";
import { EVAL_SUITE_KEY, SDLC_RUN_STATE, SLO_SIGNAL_KEY } from "../../src/shared/domain";

function createConnection(): DatabaseConnection {
  return new DatabaseConnection(join(tmpdir(), `agentcompany-new-replay-${randomUUID()}.db`));
}

function createOrganization(organization: OrganizationService): string {
  return organization.createOrganization({
    organizationName: "Acme Operations",
    employeeName: "Dana Lee",
    mission: "Coordinate agents with auditable approvals.",
    goal: "Ship a verified control plane.",
  });
}

describe("replay eval", () => {
  test("creates deterministic thread replay evidence and runs replay eval suite", () => {
    const connection = createConnection();
    const organization = new OrganizationService(connection.db);
    const chat = new ChatService(connection.db);
    const audit = new AuditService(connection.db);
    const operations = new OperationsService(connection.db);
    const sdlc = new SdlcService(connection.db);
    const snapshot = new SnapshotService(connection.db);
    let orgId = "";
    let employeeId = "";
    let threadId = "";
    let replayRunId = "";
    let evalRunId = "";

    connection.transaction(() => {
      orgId = createOrganization(organization);
      employeeId = (connection.db.prepare("select id from employees where org_id = ?").get(orgId) as { id: string }).id;
      const spaceId = chat.createSpace({
        orgId,
        spaceType: "project",
        name: "release",
        topic: "Release coordination",
        visibility: "workspace",
      });
      const messageId = chat.sendMessage({
        orgId,
        spaceId,
        threadId: null,
        senderType: "employee",
        senderId: employeeId,
        bodyMd: "/escalate replay the release approval trail",
        attachmentFileIds: [],
      });
      threadId = (connection.db.prepare("select thread_id from chat_messages where id = ?").get(messageId) as { thread_id: string }).thread_id;
      replayRunId = audit.createThreadReplay({ orgId, threadId, createdByEmployeeId: employeeId });
      operations.recordSignal({
        orgId,
        signalKey: SLO_SIGNAL_KEY.APPROVAL_ROUTE_COVERAGE,
        source: "replay_eval",
        success: true,
        durationMs: 12,
        detail: { threadId, replayRunId },
      });
      const suiteId = (connection.db.prepare("select id from eval_suites where org_id = ? and key = ?")
        .get(orgId, EVAL_SUITE_KEY.REPLAY) as { id: string }).id;
      evalRunId = sdlc.runEvalSuite({ orgId, suiteId });
    });

    const state = snapshot.load();
    const replayRun = state.auditReplayRuns.find((run) => run.id === replayRunId);
    const evalRun = state.evalRuns.find((run) => run.id === evalRunId);
    if (!replayRun) throw new Error("Audit replay run was not created.");
    if (!evalRun) throw new Error("Replay eval run was not created.");
    const replay = JSON.parse(replayRun.replayJson) as { events: Array<{ entityType: string; action: string }> };
    expect(replayRun.threadId).toBe(threadId);
    expect(replayRun.eventDigest).toBe(createHash("sha256").update(replayRun.replayJson).digest("hex"));
    expect(replayRun.eventCount).toBe(replay.events.length);
    expect(replay.events).toContainEqual(expect.objectContaining({ entityType: "chat_message", action: "sent" }));
    expect(replay.events).toContainEqual(expect.objectContaining({ entityType: "approval", action: "requested" }));
    expect(evalRun).toMatchObject({ state: SDLC_RUN_STATE.PASSED, failedCount: 0 });
    connection.close();
  });
});
