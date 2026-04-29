import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  forkMock: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { isPackaged: false },
  utilityProcess: { fork: mocks.forkMock },
}));

import { createWorkerService } from "../../src/main/worker-service";

function createWorker() {
  const worker = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    postMessage: ReturnType<typeof vi.fn>;
  };
  worker.stdout = new EventEmitter();
  worker.stderr = new EventEmitter();
  worker.postMessage = vi.fn();
  return worker;
}

describe("worker service shutdown", () => {
  beforeEach(() => {
    mocks.forkMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("keeps completed run outcomes when cleaning shutdown runs", async () => {
    const worker = createWorker();
    mocks.forkMock.mockReturnValueOnce(worker);
    const finishRun = vi.fn();
    const db = {
      projection: {
        snapshot: {
          listSnapshot: vi.fn(() => ({
            runs: [
              { id: "run-succeeded", status: "running", taskId: null, workspaceId: null },
              { id: "run-queued", status: "queued", taskId: null, workspaceId: null },
            ],
          })),
        },
      },
      core: {
        runs: {
          getRun: vi.fn((id: string) => ({
            id,
            status: id === "run-succeeded" ? "succeeded" : "queued",
          })),
          finishRun,
        },
        workspaces: { releaseWorkspaceLock: vi.fn() },
        tasks: { releaseTaskLock: vi.fn() },
      },
    };
    const service = createWorkerService({
      db,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      workerPath: "/tmp/worker.js",
      isQuitting: () => false,
      publishDomainChanged: vi.fn(),
      emitEvent: vi.fn(),
      wakeAgentIfPossible: vi.fn(() => null),
      dispatchRunToWorker: vi.fn(),
      processRunCompletion: vi.fn(),
      onRunStarted: vi.fn(),
      onRunCompleted: vi.fn(),
      notify: vi.fn(),
      budgetService: undefined,
      sessionService: undefined,
      getRuntimeBridge: vi.fn(() => null),
      getRuntimeMessageInjector: vi.fn(() => null),
    } as never);

    service.createWorker();
    const shutdown = service.shutdown();
    worker.emit("exit", 0);
    await shutdown;

    expect(worker.postMessage).toHaveBeenCalledWith({ type: "shutdown" });
    expect(finishRun).toHaveBeenCalledTimes(1);
    expect(finishRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-queued",
      status: "interrupted",
    }));
  });

  it("clears the crashed worker reference before recovery runs", () => {
    vi.useFakeTimers();
    const worker = createWorker();
    mocks.forkMock.mockReturnValueOnce(worker);
    const publishDomainChanged = vi.fn();
    const service = createWorkerService({
      db: {
        projection: {
          snapshot: {
            listSnapshot: vi.fn(() => ({ runs: [] })),
          },
        },
      },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      workerPath: "/tmp/worker.js",
      isQuitting: () => false,
      publishDomainChanged,
      emitEvent: vi.fn(),
      wakeAgentIfPossible: vi.fn(() => null),
      dispatchRunToWorker: vi.fn(),
      processRunCompletion: vi.fn(),
      onRunStarted: vi.fn(),
      onRunCompleted: vi.fn(),
      notify: vi.fn(),
      budgetService: undefined,
      sessionService: undefined,
      getRuntimeBridge: vi.fn(() => null),
      getRuntimeMessageInjector: vi.fn(() => null),
    } as never);

    service.createWorker();
    expect(service.getWorker()).toBe(worker);
    worker.emit("exit", 1);

    expect(service.getWorker()).toBeNull();
    expect(publishDomainChanged).toHaveBeenCalledOnce();
  });

  it("requeues queued crash runs after the replacement worker is created", () => {
    vi.useFakeTimers();
    const crashedWorker = createWorker();
    const replacementWorker = createWorker();
    mocks.forkMock
      .mockReturnValueOnce(crashedWorker)
      .mockReturnValueOnce(replacementWorker);
    const queuedRun = {
      id: "run-queued",
      status: "queued",
      taskId: "task-1",
      agentId: "agent-1",
      companyId: "company-1",
      workspaceId: null,
      connectorId: "openai-codex",
    };
    const dispatchRunToWorker = vi.fn();
    const service = createWorkerService({
      db: {
        projection: {
          snapshot: {
            listSnapshot: vi.fn(() => ({
              runs: [queuedRun],
              companies: [{ id: "company-1", name: "Company", description: "Recovered company" }],
            })),
          },
        },
        core: {
          runs: {
            getRun: vi.fn(() => queuedRun),
          },
          entity: {
            getTask: vi.fn(() => ({
              id: "task-1",
              companyId: "company-1",
              workspaceId: null,
              projectId: null,
              requiresFilesystem: false,
            })),
            getAgent: vi.fn(() => ({
              id: "agent-1",
              companyId: "company-1",
              connectorId: "openai-codex",
              workspaceId: null,
            })),
          },
          connectors: {
            getConnector: vi.fn(() => ({ id: "openai-codex" })),
          },
          workspaces: {
            releaseWorkspaceLock: vi.fn(),
            getCompanyObservationWorkspace: vi.fn(() => null),
          },
        },
      },
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      workerPath: "/tmp/worker.js",
      isQuitting: () => false,
      publishDomainChanged: vi.fn(),
      emitEvent: vi.fn(),
      wakeAgentIfPossible: vi.fn(() => null),
      dispatchRunToWorker,
      processRunCompletion: vi.fn(),
      onRunStarted: vi.fn(),
      onRunCompleted: vi.fn(),
      notify: vi.fn(),
      budgetService: undefined,
      sessionService: undefined,
      getRuntimeBridge: vi.fn(() => null),
      getRuntimeMessageInjector: vi.fn(() => null),
    } as never);

    service.createWorker();
    crashedWorker.emit("exit", 1);
    expect(dispatchRunToWorker).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);

    expect(service.getWorker()).toBe(replacementWorker);
    expect(dispatchRunToWorker).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-queued",
      companyId: "company-1",
      trigger: "recovery",
    }));
  });
});
