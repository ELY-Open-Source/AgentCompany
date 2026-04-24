import { EventEmitter } from "node:events";
import { describe, it, expect, vi, afterEach } from "vitest";
import { handleWorkerMessage } from "@main/worker/entry/message-handler";
import { workerMessageSchema } from "@main/worker/entry/types";
import type { RunJob } from "@main/worker/runtime/helpers";
import type { RunResourceReleaseResult } from "@main/agent-runtime/runtime-artifact-reconciler";

const RUN_ID = "00000000-0000-4000-8000-000000000001";
const NEXT_RUN_ID = "00000000-0000-4000-8000-000000000002";

function runFinishedMessage(runId: string) {
  return {
    type: "run-finished" as const,
    runId,
    status: "succeeded" as const,
    summary: null,
    errorMessage: null,
    exitCode: null,
    signal: null,
    model: "test-model",
    usageStatus: "ok" as const,
    inputTokens: 100,
    outputTokens: 50,
  };
}

function createHandlerDeps(calls: string[]) {
  const releaseWorkspaceLock = vi.fn(() => calls.push("releaseWorkspaceLock"));
  const finishRun = vi.fn(() => {
    calls.push("finishRun");
    return { budgetHardStopped: false };
  });
  const rotateSession = vi.fn(() => calls.push("rotateSession"));
  const processRunCompletion = vi.fn(() => calls.push("processRunCompletion"));
  const releaseRunResources = vi.fn((): RunResourceReleaseResult => {
    calls.push("releaseRunResources");
    return { ok: true as const };
  });
  const markRunCompletionFailure = vi.fn(() => calls.push("markRunCompletionFailure"));

  const db = {
    core: {
      runs: {
        getRun: vi.fn(() => ({
          id: RUN_ID,
          companyId: "company-1",
          agentId: "agent-1",
          taskId: null,
          workspaceId: "workspace-1",
        })),
        finishRun,
        markRunCompletionFailure,
      },
      workspaces: { releaseWorkspaceLock },
      activity: { addActivity: vi.fn(() => calls.push("addActivity")) },
      entity: {
        getAgent: vi.fn(() => ({
          id: "agent-1",
          companyId: "company-1",
          reportsTo: "manager-1",
          sessionId: "session-1",
        })),
        countActiveGoalsForCompany: vi.fn(() => 0),
      },
      tasks: {
        getSessionById: vi.fn(() => ({ id: "session-1" })),
        listAgentTasks: vi.fn(() => []),
      },
      agents: {
        getDirectReports: vi.fn(() => []),
        getChainOfCommand: vi.fn(() => []),
      },
      approvals: {
        listCompanyApprovalsByType: vi.fn(() => []),
      },
    },
    automation: {
      wakeup: {
        promoteWakeupRequests: vi.fn(() => 0),
        getPreferredWakeTrigger: vi.fn(() => null),
      },
    },
  };

  const sessionService = {
    accumulateTokenUsage: vi.fn(() => calls.push("accumulateTokenUsage")),
    evaluateRotation: vi.fn(() => ({ shouldRotate: true, reason: "unit-test" })),
    rotateSession,
  };

  return {
    deps: {
      db,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      isQuitting: vi.fn(() => false),
      emitEvent: vi.fn(() => calls.push("emitEvent")),
      wakeAgentIfPossible: vi.fn(() => null),
      processRunCompletion,
      notify: vi.fn(),
      sessionService,
      getRuntimeBridge: vi.fn(() => ({ releaseRunResources })),
      getRuntimeMessageInjector: vi.fn(() => null),
    },
    releaseWorkspaceLock,
    rotateSession,
    processRunCompletion,
    releaseRunResources,
    markRunCompletionFailure,
  };
}

function runJob(runId: string): RunJob {
  return {
    runId,
    companyId: "company-1",
    taskId: null,
    agentId: "agent-1",
    agentName: "Agent",
    connectorId: "openai-codex",
    workspaceId: "workspace-1",
    workspacePath: "/tmp/agentcompany-worker-boundary",
    workspaceMode: "exclusive",
    model: null,
    thinkingEffort: null,
    env: {},
    systemPrompt: null,
    trigger: "unit-test",
    taskSessionId: `session-${runId}`,
    executionMode: "ai_ceo",
    initialUserTurn: "Run a unit test.",
    internalTools: [],
  };
}

describe("worker completion boundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    Reflect.deleteProperty(process, "parentPort");
  });

  it("runs artifact reconciliation before automation and releases the workspace lock last", async () => {
    const calls: string[] = [];
    const {
      deps,
      releaseWorkspaceLock,
      rotateSession,
      processRunCompletion,
      releaseRunResources,
    } = createHandlerDeps(calls);
    const worker = { postMessage: vi.fn(() => calls.push("completionAck")) };

    await handleWorkerMessage(
      runFinishedMessage(RUN_ID),
      worker as never,
      deps as never,
      workerMessageSchema,
      false,
      2,
      30_000,
      new Map(),
      3,
      new Set(),
      new Map(),
    );

    expect(releaseWorkspaceLock).toHaveBeenCalledWith("workspace-1", RUN_ID);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "run-completion-ack", runId: RUN_ID });
    expect(releaseWorkspaceLock.mock.invocationCallOrder[0]).toBeGreaterThan(
      rotateSession.mock.invocationCallOrder[0]!,
    );
    expect(processRunCompletion.mock.invocationCallOrder[0]).toBeGreaterThan(
      releaseRunResources.mock.invocationCallOrder[0]!,
    );
    expect(releaseWorkspaceLock.mock.invocationCallOrder[0]).toBeGreaterThan(
      processRunCompletion.mock.invocationCallOrder[0]!,
    );
    expect(releaseWorkspaceLock.mock.invocationCallOrder[0]).toBeGreaterThan(
      releaseRunResources.mock.invocationCallOrder[0]!,
    );
  });

  it("marks run completion failed and blocks success automation when artifact reconciliation fails", async () => {
    const calls: string[] = [];
    const {
      deps,
      releaseWorkspaceLock,
      processRunCompletion,
      releaseRunResources,
      markRunCompletionFailure,
    } = createHandlerDeps(calls);
    releaseRunResources.mockImplementationOnce(() => {
      calls.push("releaseRunResources");
      return { ok: false as const, errorMessage: "completion_reconcile failed" };
    });
    const worker = { postMessage: vi.fn(() => calls.push("completionAck")) };

    await handleWorkerMessage(
      runFinishedMessage(RUN_ID),
      worker as never,
      deps as never,
      workerMessageSchema,
      false,
      2,
      30_000,
      new Map(),
      3,
      new Set(),
      new Map(),
    );

    expect(markRunCompletionFailure).toHaveBeenCalledWith(RUN_ID, "completion_reconcile failed");
    expect(processRunCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ id: RUN_ID }),
      expect.objectContaining({
        status: "failed",
        errorMessage: "completion_reconcile failed",
        usageStatus: "error_stop",
      }),
    );
    expect(releaseWorkspaceLock).toHaveBeenCalledWith("workspace-1", RUN_ID);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "run-completion-ack", runId: RUN_ID });
  });

  it("keeps same-workspace runs queued until parent acknowledges completion", async () => {
    const parentPort = new EventEmitter() as EventEmitter & {
      postMessage: ReturnType<typeof vi.fn>;
    };
    parentPort.postMessage = vi.fn();
    Object.defineProperty(process, "parentPort", {
      configurable: true,
      value: parentPort,
    });

    vi.doMock("@main/worker/runtime", () => ({
      WorkerRunner: class TestWorkerRunner {
        constructor(
          private readonly deps: {
            post: (message: unknown) => void;
            isCancelled: (runId: string) => boolean;
          },
        ) {}

        async run(job: RunJob): Promise<void> {
          this.deps.post(runFinishedMessage(job.runId));
        }

        cancel(): void {}

        steer(): boolean {
          return false;
        }

        async cancelAll(): Promise<void> {}
      },
    }));

    await import("@main/worker/entry/index");

    parentPort.emit("message", { data: { type: "enqueue-run", payload: runJob(RUN_ID) } });
    await Promise.resolve();
    await Promise.resolve();

    parentPort.emit("message", { data: { type: "enqueue-run", payload: runJob(NEXT_RUN_ID) } });
    await Promise.resolve();
    await Promise.resolve();

    expect(parentPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "run-finished", runId: RUN_ID }),
    );
    expect(parentPort.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "run-finished", runId: NEXT_RUN_ID }),
    );

    parentPort.emit("message", { data: { type: "run-completion-ack", runId: RUN_ID } });
    await Promise.resolve();
    await Promise.resolve();

    expect(parentPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "run-finished", runId: NEXT_RUN_ID }),
    );
  });

  it("reports shutdown-ready only after parent acknowledges run completion", async () => {
    const parentPort = new EventEmitter() as EventEmitter & {
      postMessage: ReturnType<typeof vi.fn>;
    };
    parentPort.postMessage = vi.fn();
    Object.defineProperty(process, "parentPort", {
      configurable: true,
      value: parentPort,
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    vi.doMock("@main/worker/runtime", () => ({
      WorkerRunner: class TestWorkerRunner {
        constructor(
          private readonly deps: {
            post: (message: unknown) => void;
          },
        ) {}

        async run(job: RunJob): Promise<void> {
          this.deps.post(runFinishedMessage(job.runId));
        }

        cancel(): void {}

        steer(): boolean {
          return false;
        }

        async cancelAll(): Promise<void> {}
      },
    }));

    await import("@main/worker/entry/index");

    parentPort.emit("message", { data: { type: "enqueue-run", payload: runJob(RUN_ID) } });
    await Promise.resolve();
    await Promise.resolve();

    parentPort.emit("message", { data: { type: "shutdown" } });
    await Promise.resolve();
    await Promise.resolve();

    expect(parentPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "run-finished", runId: RUN_ID }),
    );
    expect(parentPort.postMessage).not.toHaveBeenCalledWith({ type: "shutdown-ready" });

    parentPort.emit("message", { data: { type: "run-completion-ack", runId: RUN_ID } });
    await Promise.resolve();
    await Promise.resolve();

    expect(parentPort.postMessage).toHaveBeenCalledWith({ type: "shutdown-ready" });

    parentPort.emit("message", { data: { type: "shutdown-exit" } });
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
