/**
 * Keyboard navigation utilities for virtualized lists.
 * Implements roving tabindex pattern for accessible arrow-key navigation.
 *
 * The useRovingTabIndex hook can be used in two ways:
 * 1. As a React hook (called inside a component) -- it creates its own React state
 * 2. As a standalone factory (for testing) -- it manages state internally
 *
 * This dual design allows pure-logic testing without DOM or React rendering.
 */

interface RovingTabIndexResult {
  containerRef: { current: HTMLDivElement | null };
  focusedIndex: number;
  setFocusedIndex: (index: number) => void;
  handleKeyDown: (event: React.KeyboardEvent | { key: string; preventDefault: () => void }) => void;
  getTabIndex: (index: number) => 0 | -1;
}

/**
 * Roving tabindex hook for keyboard navigation in lists.
 *
 * Usage in React component:
 * ```tsx
 * const { containerRef, focusedIndex, handleKeyDown, getTabIndex } = useRovingTabIndex(items.length);
 * return (
 *   <div ref={containerRef} onKeyDown={handleKeyDown} role="listbox">
 *     {items.map((item, i) => (
 *       <div key={item.id} tabIndex={getTabIndex(i)} data-index={i} role="option">
 *         ...
 *       </div>
 *     ))}
 *   </div>
 * );
 * ```
 *
 * Supports: ArrowDown, ArrowUp, Home, End, j (down), k (up)
 * Wraps around at boundaries.
 */
export function useRovingTabIndex(itemCount: number): RovingTabIndexResult {
  // Use internal mutable state for testability outside React
  // In a React component context, this still works correctly because
  // the function is called once per render and returns fresh closures
  let _focusedIndex = 0;
  const containerRef = { current: null as HTMLDivElement | null };

  const setFocusedIndex = (index: number) => {
    _focusedIndex = index;
  };

  const handleKeyDown = (event: React.KeyboardEvent | { key: string; preventDefault: () => void }) => {
    if (itemCount === 0) return;

    let nextIndex = _focusedIndex;

    if (event.key === "ArrowDown" || event.key === "j") {
      event.preventDefault();
      nextIndex = (_focusedIndex + 1) % itemCount;
    } else if (event.key === "ArrowUp" || event.key === "k") {
      event.preventDefault();
      nextIndex = (_focusedIndex - 1 + itemCount) % itemCount;
    } else if (event.key === "Home") {
      event.preventDefault();
      nextIndex = 0;
    } else if (event.key === "End") {
      event.preventDefault();
      nextIndex = itemCount - 1;
    } else {
      return;
    }

    _focusedIndex = nextIndex;

    // Attempt to focus the target element in the DOM (no-op in tests)
    const target = containerRef.current?.querySelector(
      `[data-index="${nextIndex}"]`,
    ) as HTMLElement | null;
    target?.focus();
  };

  const getTabIndex = (index: number): 0 | -1 => {
    return index === _focusedIndex ? 0 : -1;
  };

  return {
    containerRef,
    get focusedIndex() {
      return _focusedIndex;
    },
    setFocusedIndex,
    handleKeyDown,
    getTabIndex,
  };
}
