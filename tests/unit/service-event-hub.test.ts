import { describe, expect, it } from "vitest";
import type { RunRecord } from "@shared/types";
import { createServiceEventHub } from "../../src/main/service-graph/service-event-hub";

type Hub = ReturnType<typeof createServiceEventHub>;
type DispatchRunPayload = Parameters<Hub["dispatchRunToWorker"]>[0];

describe("service event hub", () => {
  it("fails fast before required service handlers are registered", () => {
    const hub = createServiceEventHub();

    expect(() => hub.wakeAgentIfPossible("agent-1", "company-1", "heartbeat")).toThrow(
      "Service event hub orchestration handlers are not registered.",
    );
    expect(() => hub.dispatchAutomation("task.created", { companyId: "company-1" })).toThrow(
      "Service event hub automation handlers are not registered.",
    );
    expect(() => hub.assertReady()).toThrow(
      "Service event hub orchestration handlers are not registered.",
    );
  });

  it("routes orchestration and automation events through registered handlers", () => {
    const hub = createServiceEventHub();
    const calls: string[] = [];
    const runPayload = { runId: "run-1" } as DispatchRunPayload;
    const run = { id: "run-1" } as RunRecord;
    const runFinished = {
      status: "succeeded",
      summary: "done",
      errorMessage: null,
    } as const;

    hub.registerOrchestration({
      wakeAgentIfPossible: (agentId, companyId, trigger) => {
        calls.push(`wake:${agentId}:${companyId}:${trigger}`);
        return "run-1";
      },
      dispatchRunToWorker: (params) => {
        expect(params).toBe(runPayload);
        calls.push("dispatch-run");
      },
    });
    hub.registerAutomation({
      dispatchAutomation: (trigger, ctx) => {
        calls.push(`automation:${trigger}:${ctx.companyId}`);
      },
      processRunCompletion: (completedRun, event) => {
        expect(completedRun).toBe(run);
        expect(event).toBe(runFinished);
        calls.push("run-completion");
      },
    });

    expect(hub.hasOrchestrationHandlers()).toBe(true);
    expect(hub.wakeAgentIfPossible("agent-1", "company-1", "heartbeat")).toBe("run-1");
    hub.dispatchRunToWorker(runPayload);
    hub.dispatchAutomation("task.created", { companyId: "company-1" });
    hub.processRunCompletion(run, runFinished);
    hub.assertReady();

    expect(calls).toEqual([
      "wake:agent-1:company-1:heartbeat",
      "dispatch-run",
      "automation:task.created:company-1",
      "run-completion",
    ]);
  });

  it("rejects duplicate registrations and clears handlers during shutdown", () => {
    const hub = createServiceEventHub();
    const orchestrationHandlers = {
      wakeAgentIfPossible: () => null,
      dispatchRunToWorker: () => undefined,
    };

    hub.registerOrchestration(orchestrationHandlers);
    expect(() => hub.registerOrchestration(orchestrationHandlers)).toThrow(
      "Service event hub orchestration handlers are already registered.",
    );

    hub.clear();
    expect(hub.hasOrchestrationHandlers()).toBe(false);
    expect(() => hub.wakeAgentIfPossible(null, "company-1", "heartbeat")).toThrow(
      "Service event hub orchestration handlers are not registered.",
    );
  });
});
