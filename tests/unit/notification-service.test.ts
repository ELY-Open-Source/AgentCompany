import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Track all constructed notification instances
const constructedNotifications: Array<{
  options: Record<string, unknown>;
  clickHandler?: () => void;
  closeHandler?: () => void;
}> = [];

vi.mock("electron", () => {
  return {
    Notification: class MockNotification {
      static isSupported = () => true;
      options: Record<string, unknown>;
      _clickHandler?: () => void;
      _closeHandler?: () => void;

      constructor(options: Record<string, unknown>) {
        this.options = options;
      }

      show() {
        constructedNotifications.push({
          options: this.options,
          clickHandler: this._clickHandler,
          closeHandler: this._closeHandler,
        });
      }

      on(event: string, handler: () => void) {
        if (event === "click") this._clickHandler = handler;
        if (event === "close") this._closeHandler = handler;
        // Update the last entry if already shown, or store for later
        const last = constructedNotifications[constructedNotifications.length - 1];
        if (last && event === "click") last.clickHandler = handler;
        if (last && event === "close") last.closeHandler = handler;
      }
    },
    app: { focus: vi.fn() },
  };
});

// Import after mocking
const { createNotificationService } = await import("@main/notification-service");

describe("notification-service", () => {
  let service: ReturnType<typeof createNotificationService>;
  let mockGetMainWindow: ReturnType<typeof vi.fn>;
  let mockEmitEvent: ReturnType<typeof vi.fn>;
  let mockLogger: { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    constructedNotifications.length = 0;

    mockGetMainWindow = vi.fn(() => null);
    mockEmitEvent = vi.fn();
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
    };

    service = createNotificationService({
      getMainWindow: mockGetMainWindow,
      emitEvent: mockEmitEvent,
      logger: mockLogger,
    });
  });

  afterEach(() => {
    service.destroy();
    vi.useRealTimers();
  });

  it("Test 1: fireNotification with urgency 'critical' creates Notification with silent: false", () => {
    service.notify({
      title: "Budget Exhausted",
      body: "Agent paused",
      urgency: "critical",
    });

    expect(constructedNotifications).toHaveLength(1);
    expect(constructedNotifications[0]!.options.silent).toBe(false);
  });

  it("Test 2: fireNotification with urgency 'informational' creates Notification with silent: true", () => {
    service.notify({
      title: "Agent Hired",
      body: "Bob joined",
      urgency: "informational",
    });

    expect(constructedNotifications).toHaveLength(1);
    expect(constructedNotifications[0]!.options.silent).toBe(true);
  });

  it("Test 3: notify without batchKey fires immediately (no batching)", () => {
    service.notify({
      title: "Update Available",
      body: "Version 2.0 is ready",
      urgency: "informational",
    });

    expect(constructedNotifications).toHaveLength(1);
  });

  it("Test 4: notify with batchKey fires first event immediately, starts batch timer", () => {
    service.notify({
      title: "Task Failed",
      body: "Task A failed",
      urgency: "informational",
      navigation: { section: "tasks" },
      batchKey: "failed_runs",
    });

    expect(constructedNotifications).toHaveLength(1);
    expect(constructedNotifications[0]!.options.title).toBe("Task Failed");
  });

  it("Test 5: notify with same batchKey within 10s increments count, does NOT fire second notification", () => {
    service.notify({
      title: "Task Failed",
      body: "Task A failed",
      urgency: "informational",
      navigation: { section: "tasks" },
      batchKey: "failed_runs",
    });

    service.notify({
      title: "Task Failed",
      body: "Task B failed",
      urgency: "informational",
      navigation: { section: "tasks" },
      batchKey: "failed_runs",
    });

    // Only the first should have fired
    expect(constructedNotifications).toHaveLength(1);
  });

  it("Test 6: After 10s batch timer expires, fires summary notification with count in title", () => {
    service.notify({
      title: "Task Failed",
      body: "Task A failed",
      urgency: "informational",
      navigation: { section: "tasks" },
      batchKey: "failed_runs",
    });

    // Add 2 more batched notifications
    service.notify({
      title: "Task Failed",
      body: "Task B failed",
      urgency: "informational",
      navigation: { section: "tasks" },
      batchKey: "failed_runs",
    });
    service.notify({
      title: "Task Failed",
      body: "Task C failed",
      urgency: "informational",
      navigation: { section: "tasks" },
      batchKey: "failed_runs",
    });

    expect(constructedNotifications).toHaveLength(1); // Only first

    // Advance timer by 10 seconds
    vi.advanceTimersByTime(10_000);

    // Summary notification should have fired
    expect(constructedNotifications).toHaveLength(2);
    const summary = constructedNotifications[1]!;
    expect(summary.options.title).toContain("2");
    expect(summary.options.title).toContain("tasks failed");
    expect(summary.options.body).toBe("Click to view failed runs");
  });

  it("Test 7: Batched summary notification has no entityId (navigates to section overview)", () => {
    service.notify({
      title: "Agent Hired",
      body: "Alice joined",
      urgency: "informational",
      navigation: { section: "orgchart", entityId: "agent-1" },
      batchKey: "agent_hired",
    });

    service.notify({
      title: "Agent Hired",
      body: "Bob joined",
      urgency: "informational",
      navigation: { section: "orgchart", entityId: "agent-2" },
      batchKey: "agent_hired",
    });

    vi.advanceTimersByTime(10_000);

    // Summary notification fires -- simulate click
    expect(constructedNotifications).toHaveLength(2);
    const summaryClickHandler = constructedNotifications[1]!.clickHandler;
    expect(summaryClickHandler).toBeInstanceOf(Function);
    summaryClickHandler!();

    // emitEvent should have been called with section but no entityId
    const emitCall = mockEmitEvent.mock.calls.find(
      ([event]: [{ type: string }]) => event.type === "notification-click",
    );
    expect(emitCall).toBeDefined();
    expect(emitCall![0].section).toBe("orgchart");
    expect(emitCall![0].entityId).toBeUndefined();
  });

  it("Test 8: Events in NEVER_BATCH list always fire individually regardless of batchKey", () => {
    // pending_approval is in NEVER_BATCH
    service.notify({
      title: "Approval Required",
      body: "First approval",
      urgency: "critical",
      navigation: { section: "approvals" },
      batchKey: "pending_approval",
    });

    service.notify({
      title: "Approval Required",
      body: "Second approval",
      urgency: "critical",
      navigation: { section: "approvals" },
      batchKey: "pending_approval",
    });

    // Both should fire individually
    expect(constructedNotifications).toHaveLength(2);
  });

  it("Test 9: Active Notification objects are held in a Set and removed on 'close' event", () => {
    service.notify({
      title: "Test",
      body: "Test body",
      urgency: "informational",
    });

    expect(constructedNotifications).toHaveLength(1);

    // The close handler should exist and be callable without error
    const closeHandler = constructedNotifications[0]!.closeHandler;
    expect(closeHandler).toBeInstanceOf(Function);

    // Calling close handler should not throw (notification removed from internal Set)
    closeHandler!();
  });

  it("Test 10: On Linux, urgency 'critical' sets urgency option to 'critical'", () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });

    service.notify({
      title: "Critical Alert",
      body: "Something critical",
      urgency: "critical",
    });

    expect(constructedNotifications).toHaveLength(1);
    expect(constructedNotifications[0]!.options.urgency).toBe("critical");

    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });
});
