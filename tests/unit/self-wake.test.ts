import { describe, expect, it } from "vitest";
import { createCircuitBreaker, MAX_CONSECUTIVE_WAKES } from "@main/worker/observability/circuit-breaker";

/**
 * Tests for the self-wake circuit breaker used in worker-message-handler.ts.
 *
 * The circuit breaker prevents infinite self-wake loops when an agent is stuck
 * on a task. After MAX_CONSECUTIVE_WAKES (5) consecutive wakes without progress
 * (i.e., without a successful run), self-wake is suppressed and the agent's
 * manager is notified instead.
 */

describe("self-wake circuit breaker", () => {
  it("allows the first self-wake (counter=1)", () => {
    const map = new Map<string, number>();
    const cb = createCircuitBreaker(map);
    const allowed = cb.tryWake("agent-1", "company-1");
    expect(allowed).toBe(true);
    expect(cb.getCount("agent-1", "company-1")).toBe(1);
  });

  it("allows wakes up to MAX_CONSECUTIVE_WAKES-1 (counter=4)", () => {
    const map = new Map<string, number>();
    const cb = createCircuitBreaker(map);
    for (let i = 0; i < MAX_CONSECUTIVE_WAKES - 1; i++) {
      expect(cb.tryWake("agent-1", "company-1")).toBe(true);
    }
    expect(cb.getCount("agent-1", "company-1")).toBe(MAX_CONSECUTIVE_WAKES - 1);
  });

  it("trips after MAX_CONSECUTIVE_WAKES (5) consecutive wakes without progress", () => {
    const map = new Map<string, number>();
    const cb = createCircuitBreaker(map);
    // First 5 wakes succeed (counter goes 0->1, 1->2, 2->3, 3->4, 4->5)
    for (let i = 0; i < MAX_CONSECUTIVE_WAKES; i++) {
      expect(cb.tryWake("agent-1", "company-1")).toBe(true);
    }
    // 6th wake should trip the breaker
    const tripped = cb.tryWake("agent-1", "company-1");
    expect(tripped).toBe(false);
  });

  it("deletes the counter after circuit breaker trips (reset for next cycle)", () => {
    const map = new Map<string, number>();
    const cb = createCircuitBreaker(map);
    for (let i = 0; i < MAX_CONSECUTIVE_WAKES; i++) {
      cb.tryWake("agent-1", "company-1");
    }
    // Trip the breaker
    cb.tryWake("agent-1", "company-1");
    // Counter should be deleted
    expect(cb.getCount("agent-1", "company-1")).toBe(0);
  });

  it("resets counter to 0 on task status change", () => {
    const map = new Map<string, number>();
    const cb = createCircuitBreaker(map);
    cb.tryWake("agent-1", "company-1");
    cb.tryWake("agent-1", "company-1");
    expect(cb.getCount("agent-1", "company-1")).toBe(2);

    // Simulate a task status change -> reset
    cb.reset("agent-1", "company-1");
    expect(cb.getCount("agent-1", "company-1")).toBe(0);
  });

  it("maintains per-agent isolation (different agents have separate counters)", () => {
    const map = new Map<string, number>();
    const cb = createCircuitBreaker(map);
    // Agent 1 wakes 4 times
    for (let i = 0; i < 4; i++) {
      cb.tryWake("agent-1", "company-1");
    }
    // Agent 2 wakes 2 times
    cb.tryWake("agent-2", "company-1");
    cb.tryWake("agent-2", "company-1");

    expect(cb.getCount("agent-1", "company-1")).toBe(4);
    expect(cb.getCount("agent-2", "company-1")).toBe(2);
  });

  it("maintains per-company isolation for the same agent", () => {
    const map = new Map<string, number>();
    const cb = createCircuitBreaker(map);
    cb.tryWake("agent-1", "company-1");
    cb.tryWake("agent-1", "company-1");
    cb.tryWake("agent-1", "company-2");

    expect(cb.getCount("agent-1", "company-1")).toBe(2);
    expect(cb.getCount("agent-1", "company-2")).toBe(1);
  });

  it("allows wakes again after reset even if previously near limit", () => {
    const map = new Map<string, number>();
    const cb = createCircuitBreaker(map);
    // Get to 4 wakes
    for (let i = 0; i < MAX_CONSECUTIVE_WAKES - 1; i++) {
      cb.tryWake("agent-1", "company-1");
    }
    expect(cb.getCount("agent-1", "company-1")).toBe(MAX_CONSECUTIVE_WAKES - 1);

    // Reset
    cb.reset("agent-1", "company-1");
    expect(cb.getCount("agent-1", "company-1")).toBe(0);

    // Should allow wakes again
    expect(cb.tryWake("agent-1", "company-1")).toBe(true);
    expect(cb.getCount("agent-1", "company-1")).toBe(1);
  });

  it("resetting one agent does not affect another", () => {
    const map = new Map<string, number>();
    const cb = createCircuitBreaker(map);
    cb.tryWake("agent-1", "company-1");
    cb.tryWake("agent-1", "company-1");
    cb.tryWake("agent-2", "company-1");
    cb.tryWake("agent-2", "company-1");
    cb.tryWake("agent-2", "company-1");

    cb.reset("agent-1", "company-1");
    expect(cb.getCount("agent-1", "company-1")).toBe(0);
    expect(cb.getCount("agent-2", "company-1")).toBe(3);
  });

  it("shares state with the underlying map (same map = same state)", () => {
    const map = new Map<string, number>();
    const cb1 = createCircuitBreaker(map);
    const cb2 = createCircuitBreaker(map);
    cb1.tryWake("agent-1", "company-1");
    cb1.tryWake("agent-1", "company-1");
    // cb2 wraps the same map, so it sees the same count
    expect(cb2.getCount("agent-1", "company-1")).toBe(2);
  });
});
