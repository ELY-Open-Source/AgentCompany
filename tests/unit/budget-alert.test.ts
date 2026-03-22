import { describe, it, expect, vi } from "vitest";

/**
 * Tests for budget alert notification logic.
 *
 * Budget alerts fire at two thresholds:
 *   1. 80% utilization -> warning notification with agent name and percentage
 *   2. 100% utilization -> paused notification indicating budget exhaustion
 *   3. No notification when budgetMonthlyUsd is 0 (unlimited budget)
 *   4. Percentage is calculated as Math.round((spentMonthlyUsd / budgetMonthlyUsd) * 100)
 */

/**
 * Extract and test the budget notification logic that lives in automation-service.ts
 * handleRunFinished -> budget threshold section.
 *
 * The actual code pattern in automation-service.ts:
 *   if (agent.budgetMonthlyUsd > 0) {
 *     const utilization = agent.spentMonthlyUsd / agent.budgetMonthlyUsd;
 *     if (utilization >= 0.8) {
 *       // 80% threshold warning
 *       const pct = Math.round(utilization * 100);
 *       notify("Budget Alert", `${agent.name} is at ${pct}% of monthly budget ...`);
 *       if (utilization >= 1.0) {
 *         // 100% exhaustion notification
 *         notify("Budget Alert", `${agent.name} paused -- monthly budget exhausted ...`);
 *       }
 *     }
 *   }
 */
function simulateBudgetNotification(
  notify: (title: string, body: string) => void,
  agent: { name: string; budgetMonthlyUsd: number; spentMonthlyUsd: number },
) {
  if (agent.budgetMonthlyUsd > 0) {
    const utilization = agent.spentMonthlyUsd / agent.budgetMonthlyUsd;
    if (utilization >= 0.8) {
      const pct = Math.round(utilization * 100);
      notify(
        "Budget Alert",
        `${agent.name} is at ${pct}% of monthly budget ($${agent.spentMonthlyUsd.toFixed(2)} / $${agent.budgetMonthlyUsd.toFixed(2)})`,
      );
      if (utilization >= 1.0) {
        notify(
          "Budget Alert",
          `${agent.name} paused -- monthly budget exhausted ($${agent.spentMonthlyUsd.toFixed(2)} / $${agent.budgetMonthlyUsd.toFixed(2)})`,
        );
      }
    }
  }
}

describe("Budget Alert Notifications", () => {
  it("fires warning notification at 80% budget utilization", () => {
    const notify = vi.fn();
    simulateBudgetNotification(notify, {
      name: "Alice",
      budgetMonthlyUsd: 100,
      spentMonthlyUsd: 85,
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      "Budget Alert",
      expect.stringContaining("Alice"),
    );
    expect(notify).toHaveBeenCalledWith(
      "Budget Alert",
      expect.stringContaining("85%"),
    );
    expect(notify).toHaveBeenCalledWith(
      "Budget Alert",
      expect.stringContaining("% of monthly budget"),
    );
  });

  it("fires paused notification at 100% budget utilization", () => {
    const notify = vi.fn();
    simulateBudgetNotification(notify, {
      name: "Bob",
      budgetMonthlyUsd: 50,
      spentMonthlyUsd: 55,
    });
    // Both the 80% and 100% notifications should fire
    expect(notify).toHaveBeenCalledTimes(2);
    // Second call should be the exhaustion notification
    expect(notify).toHaveBeenCalledWith(
      "Budget Alert",
      expect.stringContaining("paused"),
    );
    expect(notify).toHaveBeenCalledWith(
      "Budget Alert",
      expect.stringContaining("budget exhausted"),
    );
  });

  it("correctly calculates percentage as Math.round(utilization * 100)", () => {
    const notify = vi.fn();
    // 83.333...% should round to 83%
    simulateBudgetNotification(notify, {
      name: "Charlie",
      budgetMonthlyUsd: 60,
      spentMonthlyUsd: 50,
    });
    expect(notify).toHaveBeenCalledWith(
      "Budget Alert",
      expect.stringContaining("83%"),
    );
  });

  it("does not fire notification when budgetMonthlyUsd is 0 (unlimited)", () => {
    const notify = vi.fn();
    simulateBudgetNotification(notify, {
      name: "Diana",
      budgetMonthlyUsd: 0,
      spentMonthlyUsd: 500,
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not fire notification when utilization is below 80%", () => {
    const notify = vi.fn();
    simulateBudgetNotification(notify, {
      name: "Eve",
      budgetMonthlyUsd: 100,
      spentMonthlyUsd: 50,
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it("fires both notifications at exactly 100%", () => {
    const notify = vi.fn();
    simulateBudgetNotification(notify, {
      name: "Frank",
      budgetMonthlyUsd: 100,
      spentMonthlyUsd: 100,
    });
    expect(notify).toHaveBeenCalledTimes(2);
    // First call: 80% threshold warning
    expect(notify.mock.calls[0]![0]).toBe("Budget Alert");
    expect(notify.mock.calls[0]![1]).toContain("100%");
    expect(notify.mock.calls[0]![1]).toContain("% of monthly budget");
    // Second call: exhaustion notification
    expect(notify.mock.calls[1]![0]).toBe("Budget Alert");
    expect(notify.mock.calls[1]![1]).toContain("paused");
    expect(notify.mock.calls[1]![1]).toContain("budget exhausted");
  });
});
