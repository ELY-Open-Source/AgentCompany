import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { isPackaged: false },
  utilityProcess: { fork: vi.fn() },
  powerMonitor: {
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

import { createRuntimeOrchestrationService } from "../../src/main/service-graph/create-runtime-orchestration-service";

function createService() {
  return createRuntimeOrchestrationService({
    db: {} as never,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    workerPath: "/tmp/worker.js",
    isQuittingRef: { current: false },
    publishDomainChanged: vi.fn(),
    emitEvent: vi.fn(),
    notify: vi.fn(),
    createRunToken: vi.fn(() => "token"),
    getApiPort: vi.fn(() => 0),
    skillService: {
      listRuntimeSkillEntries: vi.fn(() => []),
    } as never,
    budgetService: {
      evaluateBudgetGate: vi.fn(() => ({ allowed: true, blockedBy: [] })),
    } as never,
    sessionService: {
      getHandoffForAgent: vi.fn(() => null),
      evaluateRotation: vi.fn(() => ({ shouldRotate: false, reason: null })),
      rotateSession: vi.fn(),
    } as never,
    piRuntimeRef: { current: null },
    getRuntimeMessageInjector: vi.fn(() => null),
  });
}

describe("runtime orchestration service", () => {
  it("requires automation handlers to be bound exactly once", () => {
    const service = createService();
    const handlers = {
      dispatchAutomation: vi.fn(),
      processRunCompletion: vi.fn(),
    };

    expect(() => service.assertReady()).toThrow(
      "Runtime orchestration automation handlers are not bound.",
    );

    service.bindAutomation(handlers);

    expect(() => service.assertReady()).not.toThrow();
    expect(() => service.bindAutomation(handlers)).toThrow(
      "Runtime orchestration automation handlers are already bound.",
    );
  });
});
