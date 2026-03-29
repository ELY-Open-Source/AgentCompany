import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDomainEventBatcher, type GranularEventEntry } from "@renderer/lib/ipc-batcher";
import type { DesktopEvent } from "@shared/types";

describe("createDomainEventBatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("domain-changed event triggers full refresh callback after 50ms window", () => {
    const onFull = vi.fn();
    const onGranular = vi.fn();
    const batcher = createDomainEventBatcher(onFull, onGranular, 50);

    const domainEvent: DesktopEvent = { type: "domain-changed" };
    batcher.push(domainEvent);

    expect(onFull).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(onFull).toHaveBeenCalledTimes(1);
    expect(onGranular).not.toHaveBeenCalled();
  });

  it("multiple domain-changed events in same window coalesce to single full refresh", () => {
    const onFull = vi.fn();
    const onGranular = vi.fn();
    const batcher = createDomainEventBatcher(onFull, onGranular, 50);

    batcher.push({ type: "domain-changed" } as DesktopEvent);
    batcher.push({ type: "domain-changed" } as DesktopEvent);
    batcher.push({ type: "domain-changed" } as DesktopEvent);

    vi.advanceTimersByTime(50);
    expect(onFull).toHaveBeenCalledTimes(1);
  });

  it("single task-updated event triggers granular batch callback with one entry after 50ms", () => {
    const onFull = vi.fn();
    const onGranular = vi.fn();
    const batcher = createDomainEventBatcher(onFull, onGranular, 50);

    const taskEvent: DesktopEvent = { type: "task-updated", taskId: "t-1", action: "updated" };
    batcher.push(taskEvent);

    vi.advanceTimersByTime(50);
    expect(onGranular).toHaveBeenCalledTimes(1);
    expect(onFull).not.toHaveBeenCalled();

    const entries: GranularEventEntry[] = onGranular.mock.calls[0]![0];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ type: "task-updated", entityId: "t-1", action: "updated" });
  });

  it("multiple task-updated events for SAME taskId coalesce to single entry (last-write-wins on action)", () => {
    const onFull = vi.fn();
    const onGranular = vi.fn();
    const batcher = createDomainEventBatcher(onFull, onGranular, 50);

    batcher.push({ type: "task-updated", taskId: "t-1", action: "created" } as DesktopEvent);
    batcher.push({ type: "task-updated", taskId: "t-1", action: "updated" } as DesktopEvent);

    vi.advanceTimersByTime(50);
    const entries: GranularEventEntry[] = onGranular.mock.calls[0]![0];
    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe("updated");
  });

  it("multiple task-updated events for DIFFERENT taskIds produce separate entries", () => {
    const onFull = vi.fn();
    const onGranular = vi.fn();
    const batcher = createDomainEventBatcher(onFull, onGranular, 50);

    batcher.push({ type: "task-updated", taskId: "t-1", action: "updated" } as DesktopEvent);
    batcher.push({ type: "task-updated", taskId: "t-2", action: "created" } as DesktopEvent);

    vi.advanceTimersByTime(50);
    const entries: GranularEventEntry[] = onGranular.mock.calls[0]![0];
    expect(entries).toHaveLength(2);
  });

  it("domain-changed in same window as granular events causes full refresh (domain-changed overrides)", () => {
    const onFull = vi.fn();
    const onGranular = vi.fn();
    const batcher = createDomainEventBatcher(onFull, onGranular, 50);

    batcher.push({ type: "task-updated", taskId: "t-1", action: "updated" } as DesktopEvent);
    batcher.push({ type: "run-updated", runId: "r-1", action: "completed" } as DesktopEvent);
    batcher.push({ type: "domain-changed" } as DesktopEvent);

    vi.advanceTimersByTime(50);
    expect(onFull).toHaveBeenCalledTimes(1);
    expect(onGranular).not.toHaveBeenCalled();
  });

  it("more than 10 unique granular entities in one window triggers full refresh instead of granular batch", () => {
    const onFull = vi.fn();
    const onGranular = vi.fn();
    const batcher = createDomainEventBatcher(onFull, onGranular, 50);

    // Push 11 unique task-updated events
    for (let i = 0; i < 11; i++) {
      batcher.push({ type: "task-updated", taskId: `t-${i}`, action: "updated" } as DesktopEvent);
    }

    vi.advanceTimersByTime(50);
    expect(onFull).toHaveBeenCalledTimes(1);
    expect(onGranular).not.toHaveBeenCalled();
  });

  it("flush() immediately processes pending events", () => {
    const onFull = vi.fn();
    const onGranular = vi.fn();
    const batcher = createDomainEventBatcher(onFull, onGranular, 50);

    batcher.push({ type: "task-updated", taskId: "t-1", action: "created" } as DesktopEvent);
    batcher.flush();

    expect(onGranular).toHaveBeenCalledTimes(1);
    // Should not fire again on timer
    vi.advanceTimersByTime(100);
    expect(onGranular).toHaveBeenCalledTimes(1);
  });

  it("dispose() cancels pending events without firing callbacks", () => {
    const onFull = vi.fn();
    const onGranular = vi.fn();
    const batcher = createDomainEventBatcher(onFull, onGranular, 50);

    batcher.push({ type: "task-updated", taskId: "t-1", action: "created" } as DesktopEvent);
    batcher.dispose();

    vi.advanceTimersByTime(100);
    expect(onFull).not.toHaveBeenCalled();
    expect(onGranular).not.toHaveBeenCalled();
  });

  it("run-log, shortcut, notification-click events are NOT handled by batcher (treated as unknown, triggers full refresh)", () => {
    const onFull = vi.fn();
    const onGranular = vi.fn();
    const batcher = createDomainEventBatcher(onFull, onGranular, 50);

    // These events are not recognized as granular -- per D-05, unknown triggers full refresh
    batcher.push({ type: "run-log", runId: "r-1", stream: "stdout", text: "hi" } as DesktopEvent);

    vi.advanceTimersByTime(50);
    expect(onFull).toHaveBeenCalledTimes(1);
    expect(onGranular).not.toHaveBeenCalled();
  });

  it("budget-changed event appears in granular batch with companyId as entity key", () => {
    const onFull = vi.fn();
    const onGranular = vi.fn();
    const batcher = createDomainEventBatcher(onFull, onGranular, 50);

    batcher.push({ type: "budget-changed", companyId: "c-1" } as DesktopEvent);

    vi.advanceTimersByTime(50);
    expect(onGranular).toHaveBeenCalledTimes(1);
    const entries: GranularEventEntry[] = onGranular.mock.calls[0]![0];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ type: "budget-changed", entityId: "c-1", action: "changed" });
  });

  it("if any event in window has action 'deleted', that action survives coalescing for that entity", () => {
    const onFull = vi.fn();
    const onGranular = vi.fn();
    const batcher = createDomainEventBatcher(onFull, onGranular, 50);

    batcher.push({ type: "task-updated", taskId: "t-1", action: "deleted" } as DesktopEvent);
    batcher.push({ type: "task-updated", taskId: "t-1", action: "updated" } as DesktopEvent);

    vi.advanceTimersByTime(50);
    const entries: GranularEventEntry[] = onGranular.mock.calls[0]![0];
    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe("deleted");
  });
});
