import { describe, it, expect, vi } from "vitest";
import { checkBudgetThreshold } from "@main/automation/automation-run-completion";

/**
 * Tests for budget alert notification logic in automation-run-completion.ts.
 *
 * Budget alerts fire at two thresholds:
 *   1. >= 80% utilization  -> warning notification with agent name and percentage
 *   2. >= 100% utilization -> exhaustion notification (both fire)
 *   3. budgetMonthlyUsd <= 0 (unlimited) -> no notification
 */

/** Identity localizer: returns the English string, as in the production default path. */
function en(enStr: string, _zh: string): string {
  return enStr;
}

describe("Budget Alert Notifications", () => {
  it("fires warning notification at 80% budget utilization", () => {
    const notify = vi.fn();
    checkBudgetThreshold(
      { name: "Alice", budgetMonthlyUsd: 100, spentMonthlyUsd: 85 },
      notify,
      en,
    );
    expect(notify).toHaveBeenCalledTimes(1);
    const call = notify.mock.calls[0]![0] as { title: string; body: string };
    expect(call.title).toContain("Budget");
    expect(call.body).toContain("Alice");
    expect(call.body).toContain("85%");
  });

  it("fires both notifications at >= 100% utilization", () => {
    const notify = vi.fn();
    checkBudgetThreshold(
      { name: "Bob", budgetMonthlyUsd: 50, spentMonthlyUsd: 55 },
      notify,
      en,
    );
    expect(notify).toHaveBeenCalledTimes(2);
    const bodies = notify.mock.calls.map((c) => (c[0] as { body: string }).body);
    // Second call is the exhaustion notification
    expect(bodies[1]).toContain("100%");
  });

  it("correctly rounds percentage as Math.round(utilization * 100)", () => {
    const notify = vi.fn();
    // 83.333...% should round to 83%
    checkBudgetThreshold(
      { name: "Charlie", budgetMonthlyUsd: 60, spentMonthlyUsd: 50 },
      notify,
      en,
    );
    const body = (notify.mock.calls[0]![0] as { body: string }).body;
    expect(body).toContain("83%");
  });

  it("does not fire notification when budgetMonthlyUsd is 0 (unlimited)", () => {
    const notify = vi.fn();
    checkBudgetThreshold(
      { name: "Diana", budgetMonthlyUsd: 0, spentMonthlyUsd: 500 },
      notify,
      en,
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not fire notification when utilization is below 80%", () => {
    const notify = vi.fn();
    checkBudgetThreshold(
      { name: "Eve", budgetMonthlyUsd: 100, spentMonthlyUsd: 50 },
      notify,
      en,
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it("fires both notifications at exactly 100%", () => {
    const notify = vi.fn();
    checkBudgetThreshold(
      { name: "Frank", budgetMonthlyUsd: 100, spentMonthlyUsd: 100 },
      notify,
      en,
    );
    expect(notify).toHaveBeenCalledTimes(2);
    const first = notify.mock.calls[0]![0] as { title: string; body: string };
    const second = notify.mock.calls[1]![0] as { title: string; body: string };
    expect(first.body).toContain("100%");
    expect(second.title).toContain("Exhausted");
  });

  it("does not fire notification when budgetMonthlyUsd is negative", () => {
    const notify = vi.fn();
    checkBudgetThreshold(
      { name: "Grace", budgetMonthlyUsd: -10, spentMonthlyUsd: 500 },
      notify,
      en,
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it("fires only the warning (not exhaustion) at exactly 80%", () => {
    const notify = vi.fn();
    checkBudgetThreshold(
      { name: "Hank", budgetMonthlyUsd: 100, spentMonthlyUsd: 80 },
      notify,
      en,
    );
    expect(notify).toHaveBeenCalledTimes(1);
    const body = (notify.mock.calls[0]![0] as { body: string }).body;
    expect(body).toContain("80%");
  });
});
