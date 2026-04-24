import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

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
});
