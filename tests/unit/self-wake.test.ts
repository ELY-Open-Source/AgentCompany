import { describe, expect, it } from "vitest";

/**
 * Tests for the self-wake circuit breaker pattern used in worker-service.ts.
 *
 * The circuit breaker prevents infinite self-wake loops when an agent is stuck
 * on a task. After MAX_CONSECUTIVE_WAKES (5) consecutive wakes without progress
 * (i.e., without a task status change), self-wake is suppressed and the agent's
 * manager is notified instead.
 */

const MAX_CONSECUTIVE_WAKES = 5;

/**
 * Standalone circuit breaker logic extracted for testability.
 * Mirrors the pattern used inside createWorkerService.
 */
function createCircuitBreaker(maxConsecutive: number = MAX_CONSECUTIVE_WAKES) {
  const consecutiveWakeMap = new Map<string, number>();

  return {
    /** Attempt a self-wake. Returns true if allowed, false if circuit breaker trips. */
    tryWake(agentId: string, companyId: string): boolean {
      const wakeKey = `${agentId}:${companyId}`;
      const count = consecutiveWakeMap.get(wakeKey) ?? 0;

      if (count >= maxConsecutive) {
        consecutiveWakeMap.delete(wakeKey);
        return false; // Circuit breaker tripped
      }

      consecutiveWakeMap.set(wakeKey, count + 1);
      return true;
    },

    /** Reset the counter for an agent (called on task progress). */
    reset(agentId: string, companyId: string): void {
      const wakeKey = `${agentId}:${companyId}`;
      consecutiveWakeMap.delete(wakeKey);
    },

    /** Get the current count for an agent. */
    getCount(agentId: string, companyId: string): number {
      const wakeKey = `${agentId}:${companyId}`;
      return consecutiveWakeMap.get(wakeKey) ?? 0;
    },
  };
}

describe("self-wake circuit breaker", () => {
  it("allows the first self-wake (counter=1)", () => {
    const cb = createCircuitBreaker();
    const allowed = cb.tryWake("agent-1", "company-1");
    expect(allowed).toBe(true);
    expect(cb.getCount("agent-1", "company-1")).toBe(1);
  });

  it("allows wakes up to MAX_CONSECUTIVE_WAKES-1 (counter=4)", () => {
    const cb = createCircuitBreaker();
    for (let i = 0; i < MAX_CONSECUTIVE_WAKES - 1; i++) {
      expect(cb.tryWake("agent-1", "company-1")).toBe(true);
    }
    expect(cb.getCount("agent-1", "company-1")).toBe(MAX_CONSECUTIVE_WAKES - 1);
  });

  it("trips after MAX_CONSECUTIVE_WAKES (5) consecutive wakes without progress", () => {
    const cb = createCircuitBreaker();
    // First 5 wakes succeed (counter goes 0->1, 1->2, 2->3, 3->4, 4->5)
    for (let i = 0; i < MAX_CONSECUTIVE_WAKES; i++) {
      expect(cb.tryWake("agent-1", "company-1")).toBe(true);
    }
    // 6th wake should trip the breaker
    const tripped = cb.tryWake("agent-1", "company-1");
    expect(tripped).toBe(false);
  });

  it("deletes the counter after circuit breaker trips (reset for next cycle)", () => {
    const cb = createCircuitBreaker();
    for (let i = 0; i < MAX_CONSECUTIVE_WAKES; i++) {
      cb.tryWake("agent-1", "company-1");
    }
    // Trip the breaker
    cb.tryWake("agent-1", "company-1");
    // Counter should be deleted
    expect(cb.getCount("agent-1", "company-1")).toBe(0);
  });

  it("resets counter to 0 on task status change", () => {
    const cb = createCircuitBreaker();
    cb.tryWake("agent-1", "company-1");
    cb.tryWake("agent-1", "company-1");
    expect(cb.getCount("agent-1", "company-1")).toBe(2);

    // Simulate a task status change -> reset
    cb.reset("agent-1", "company-1");
    expect(cb.getCount("agent-1", "company-1")).toBe(0);
  });

  it("maintains per-agent isolation (different agents have separate counters)", () => {
    const cb = createCircuitBreaker();
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
    const cb = createCircuitBreaker();
    cb.tryWake("agent-1", "company-1");
    cb.tryWake("agent-1", "company-1");
    cb.tryWake("agent-1", "company-2");

    expect(cb.getCount("agent-1", "company-1")).toBe(2);
    expect(cb.getCount("agent-1", "company-2")).toBe(1);
  });

  it("allows wakes again after reset even if previously near limit", () => {
    const cb = createCircuitBreaker();
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
    const cb = createCircuitBreaker();
    cb.tryWake("agent-1", "company-1");
    cb.tryWake("agent-1", "company-1");
    cb.tryWake("agent-2", "company-1");
    cb.tryWake("agent-2", "company-1");
    cb.tryWake("agent-2", "company-1");

    cb.reset("agent-1", "company-1");
    expect(cb.getCount("agent-1", "company-1")).toBe(0);
    expect(cb.getCount("agent-2", "company-1")).toBe(3);
  });
});
