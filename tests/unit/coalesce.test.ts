import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { coalesce } from "../../src/main/app/coalesce";

describe("coalesce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("collapses a burst into one trailing call", () => {
    const calls: number[] = [];
    const notify = coalesce(() => calls.push(Date.now()), 200);
    notify();
    notify();
    notify();
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(199);
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(calls).toHaveLength(1);
  });

  test("fires again for events after the window closes", () => {
    let count = 0;
    const notify = coalesce(() => { count += 1; }, 200);
    notify();
    vi.advanceTimersByTime(200);
    expect(count).toBe(1);
    notify();
    notify();
    vi.advanceTimersByTime(200);
    expect(count).toBe(2);
  });

  test("an event during the pending window is covered by the trailing call", () => {
    let count = 0;
    const notify = coalesce(() => { count += 1; }, 200);
    notify();
    vi.advanceTimersByTime(100);
    notify();
    vi.advanceTimersByTime(100);
    expect(count).toBe(1);
    vi.advanceTimersByTime(200);
    expect(count).toBe(1);
  });
});
