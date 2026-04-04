import { useCallback, useRef, useState } from "react";

interface RovingTabIndexResult {
  containerRef: { current: HTMLDivElement | null };
  focusedIndex: number;
  setFocusedIndex: (index: number) => void;
  handleKeyDown: (event: React.KeyboardEvent | { key: string; preventDefault: () => void }) => void;
  getTabIndex: (index: number) => 0 | -1;
}

/**
 * Core roving-tabindex logic, independent of React.
 * Used directly by tests and wrapped by `useRovingTabIndex` for React components.
 */
export function createRovingTabIndex(itemCount: number): RovingTabIndexResult {
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

/** React hook wrapper around roving tabindex. Uses real React state for reactivity in components. */
export function useRovingTabIndex(itemCount: number): RovingTabIndexResult {
  const [focusedIndex, setFocusedIndexState] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const focusedRef = useRef(0);

  const setFocusedIndex = useCallback((index: number) => {
    focusedRef.current = index;
    setFocusedIndexState(index);
  }, []);

  const handleKeyDown = useCallback((event: React.KeyboardEvent | { key: string; preventDefault: () => void }) => {
    if (itemCount === 0) return;

    let nextIndex = focusedRef.current;

    if (event.key === "ArrowDown" || event.key === "j") {
      event.preventDefault();
      nextIndex = (focusedRef.current + 1) % itemCount;
    } else if (event.key === "ArrowUp" || event.key === "k") {
      event.preventDefault();
      nextIndex = (focusedRef.current - 1 + itemCount) % itemCount;
    } else if (event.key === "Home") {
      event.preventDefault();
      nextIndex = 0;
    } else if (event.key === "End") {
      event.preventDefault();
      nextIndex = itemCount - 1;
    } else {
      return;
    }

    focusedRef.current = nextIndex;
    setFocusedIndexState(nextIndex);

    const target = containerRef.current?.querySelector(
      `[data-index="${nextIndex}"]`,
    ) as HTMLElement | null;
    target?.focus();
  }, [itemCount]);

  const getTabIndex = useCallback((index: number): 0 | -1 => {
    return index === focusedRef.current ? 0 : -1;
  }, []);

  return {
    containerRef,
    focusedIndex,
    setFocusedIndex,
    handleKeyDown,
    getTabIndex,
  };
}
