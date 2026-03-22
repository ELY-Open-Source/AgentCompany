import { describe, it, expect } from "vitest";
import { useRovingTabIndex } from "@renderer/lib/keyboard";

// Since vitest runs in Node (no DOM), we test the hook logic
// by extracting and testing the pure callback functions directly.
// We create a minimal mock of React hooks to isolate the logic.

// -- Helper to create a mock KeyboardEvent-like object --
function mockKeyEvent(key: string): {
  key: string;
  preventDefault: () => void;
  defaultPrevented: boolean;
} {
  let prevented = false;
  return {
    key,
    preventDefault() {
      prevented = true;
    },
    get defaultPrevented() {
      return prevented;
    },
  };
}

describe("useRovingTabIndex", () => {
  it("returns containerRef, focusedIndex (default 0), handleKeyDown, getTabIndex", () => {
    const result = useRovingTabIndex(5);
    expect(result).toHaveProperty("containerRef");
    expect(result).toHaveProperty("focusedIndex");
    expect(result).toHaveProperty("handleKeyDown");
    expect(result).toHaveProperty("getTabIndex");
    expect(result.focusedIndex).toBe(0);
    expect(typeof result.handleKeyDown).toBe("function");
    expect(typeof result.getTabIndex).toBe("function");
  });

  it("ArrowDown increments focusedIndex, wraps from last to 0", () => {
    const result = useRovingTabIndex(3);
    expect(result.focusedIndex).toBe(0);

    // Press ArrowDown once -> index 1
    const event1 = mockKeyEvent("ArrowDown");
    result.handleKeyDown(event1 as unknown as React.KeyboardEvent);
    expect(result.focusedIndex).toBe(1);
    expect(event1.defaultPrevented).toBe(true);

    // Press ArrowDown again -> index 2
    const event2 = mockKeyEvent("ArrowDown");
    result.handleKeyDown(event2 as unknown as React.KeyboardEvent);
    expect(result.focusedIndex).toBe(2);

    // Press ArrowDown again -> wraps to 0
    const event3 = mockKeyEvent("ArrowDown");
    result.handleKeyDown(event3 as unknown as React.KeyboardEvent);
    expect(result.focusedIndex).toBe(0);
  });

  it("ArrowUp decrements focusedIndex, wraps from 0 to last", () => {
    const result = useRovingTabIndex(3);
    expect(result.focusedIndex).toBe(0);

    // Press ArrowUp at 0 -> wraps to 2
    const event1 = mockKeyEvent("ArrowUp");
    result.handleKeyDown(event1 as unknown as React.KeyboardEvent);
    expect(result.focusedIndex).toBe(2);
    expect(event1.defaultPrevented).toBe(true);

    // Press ArrowUp at 2 -> index 1
    const event2 = mockKeyEvent("ArrowUp");
    result.handleKeyDown(event2 as unknown as React.KeyboardEvent);
    expect(result.focusedIndex).toBe(1);
  });

  it("Home sets focusedIndex to 0", () => {
    const result = useRovingTabIndex(5);
    // Move to index 3 first
    result.handleKeyDown(mockKeyEvent("ArrowDown") as unknown as React.KeyboardEvent);
    result.handleKeyDown(mockKeyEvent("ArrowDown") as unknown as React.KeyboardEvent);
    result.handleKeyDown(mockKeyEvent("ArrowDown") as unknown as React.KeyboardEvent);
    expect(result.focusedIndex).toBe(3);

    // Press Home -> index 0
    const event = mockKeyEvent("Home");
    result.handleKeyDown(event as unknown as React.KeyboardEvent);
    expect(result.focusedIndex).toBe(0);
    expect(event.defaultPrevented).toBe(true);
  });

  it("End sets focusedIndex to itemCount - 1", () => {
    const result = useRovingTabIndex(5);
    expect(result.focusedIndex).toBe(0);

    // Press End -> index 4
    const event = mockKeyEvent("End");
    result.handleKeyDown(event as unknown as React.KeyboardEvent);
    expect(result.focusedIndex).toBe(4);
    expect(event.defaultPrevented).toBe(true);
  });

  it("getTabIndex returns 0 for focusedIndex, -1 for others", () => {
    const result = useRovingTabIndex(5);
    // Default focusedIndex is 0
    expect(result.getTabIndex(0)).toBe(0);
    expect(result.getTabIndex(1)).toBe(-1);
    expect(result.getTabIndex(2)).toBe(-1);
    expect(result.getTabIndex(4)).toBe(-1);

    // Move to index 2
    result.handleKeyDown(mockKeyEvent("ArrowDown") as unknown as React.KeyboardEvent);
    result.handleKeyDown(mockKeyEvent("ArrowDown") as unknown as React.KeyboardEvent);
    expect(result.focusedIndex).toBe(2);
    expect(result.getTabIndex(0)).toBe(-1);
    expect(result.getTabIndex(2)).toBe(0);
  });

  it("j key acts same as ArrowDown, k key acts same as ArrowUp", () => {
    const result = useRovingTabIndex(3);
    expect(result.focusedIndex).toBe(0);

    // j -> index 1
    const jEvent = mockKeyEvent("j");
    result.handleKeyDown(jEvent as unknown as React.KeyboardEvent);
    expect(result.focusedIndex).toBe(1);
    expect(jEvent.defaultPrevented).toBe(true);

    // j -> index 2
    result.handleKeyDown(mockKeyEvent("j") as unknown as React.KeyboardEvent);
    expect(result.focusedIndex).toBe(2);

    // k -> index 1
    const kEvent = mockKeyEvent("k");
    result.handleKeyDown(kEvent as unknown as React.KeyboardEvent);
    expect(result.focusedIndex).toBe(1);
    expect(kEvent.defaultPrevented).toBe(true);

    // k -> index 0
    result.handleKeyDown(mockKeyEvent("k") as unknown as React.KeyboardEvent);
    expect(result.focusedIndex).toBe(0);
  });

  it("handleKeyDown is no-op when itemCount is 0", () => {
    const result = useRovingTabIndex(0);
    expect(result.focusedIndex).toBe(0);

    const event = mockKeyEvent("ArrowDown");
    result.handleKeyDown(event as unknown as React.KeyboardEvent);
    expect(result.focusedIndex).toBe(0);
    // preventDefault should NOT be called when itemCount is 0
    expect(event.defaultPrevented).toBe(false);
  });
});
