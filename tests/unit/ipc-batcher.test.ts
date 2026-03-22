import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createEventBatcher } from "@renderer/lib/ipc-batcher";

describe("createEventBatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls callback after windowMs timeout (50ms)", () => {
    const callback = vi.fn();
    const batcher = createEventBatcher(callback, 50);

    batcher.schedule();
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("coalesces multiple schedule() calls within window into single callback", () => {
    const callback = vi.fn();
    const batcher = createEventBatcher(callback, 50);

    batcher.schedule();
    batcher.schedule();
    batcher.schedule();

    vi.advanceTimersByTime(50);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("flush() immediately invokes callback and clears pending timer", () => {
    const callback = vi.fn();
    const batcher = createEventBatcher(callback, 50);

    batcher.schedule();
    batcher.flush();

    expect(callback).toHaveBeenCalledTimes(1);

    // Advancing time should not trigger another callback
    vi.advanceTimersByTime(100);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("dispose() cancels pending timer without invoking callback", () => {
    const callback = vi.fn();
    const batcher = createEventBatcher(callback, 50);

    batcher.schedule();
    batcher.dispose();

    vi.advanceTimersByTime(100);
    expect(callback).not.toHaveBeenCalled();
  });

  it("schedule() after flush() starts new timer", () => {
    const callback = vi.fn();
    const batcher = createEventBatcher(callback, 50);

    batcher.schedule();
    batcher.flush();
    expect(callback).toHaveBeenCalledTimes(1);

    batcher.schedule();
    vi.advanceTimersByTime(50);
    expect(callback).toHaveBeenCalledTimes(2);
  });
});
