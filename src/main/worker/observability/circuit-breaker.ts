/**
 * Self-wake circuit breaker.
 *
 * Prevents infinite self-wake loops when an agent is stuck on a task.
 * After MAX_CONSECUTIVE_WAKES consecutive wakes without progress (i.e.,
 * without a successful run), self-wake is suppressed so the manager can
 * be notified instead.
 */

export const MAX_CONSECUTIVE_WAKES = 5;

export interface CircuitBreaker {
  /** Attempt a self-wake. Returns true if allowed, false if circuit breaker trips. */
  tryWake(agentId: string, companyId: string): boolean;
  /** Reset the counter for an agent (called on task progress / successful run). */
  reset(agentId: string, companyId: string): void;
  /** Get the current consecutive-wake count for an agent. */
  getCount(agentId: string, companyId: string): number;
}

export function createCircuitBreaker(
  consecutiveWakeMap: Map<string, number>,
  maxConsecutive: number = MAX_CONSECUTIVE_WAKES,
): CircuitBreaker {
  function wakeKey(agentId: string, companyId: string): string {
    return `${agentId}:${companyId}`;
  }

  return {
    tryWake(agentId: string, companyId: string): boolean {
      const key = wakeKey(agentId, companyId);
      const count = consecutiveWakeMap.get(key) ?? 0;
      if (count >= maxConsecutive) {
        consecutiveWakeMap.delete(key);
        return false;
      }
      consecutiveWakeMap.set(key, count + 1);
      return true;
    },

    reset(agentId: string, companyId: string): void {
      consecutiveWakeMap.delete(wakeKey(agentId, companyId));
    },

    getCount(agentId: string, companyId: string): number {
      return consecutiveWakeMap.get(wakeKey(agentId, companyId)) ?? 0;
    },
  };
}
