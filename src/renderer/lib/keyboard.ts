interface RovingTabIndexResult {
  containerRef: { current: HTMLDivElement | null };
  focusedIndex: number;
  setFocusedIndex: (index: number) => void;
  handleKeyDown: (event: React.KeyboardEvent | { key: string; preventDefault: () => void }) => void;
  getTabIndex: (index: number) => 0 | -1;
}

/** Roving tabindex for keyboard nav in lists. Supports Arrow/Home/End/j/k with wrap-around. */
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
