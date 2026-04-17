import { useCallback, useRef, useState } from "react";

interface RovingTabIndexResult {
  containerRef: { current: HTMLDivElement | null };
  focusedIndex: number;
  setFocusedIndex: (index: number) => void;
  handleKeyDown: (event: React.KeyboardEvent | { key: string; preventDefault: () => void }) => void;
  getTabIndex: (index: number) => 0 | -1;
}

function nextIndexFor(key: string, current: number, itemCount: number): number | null {
  if (key === "ArrowDown" || key === "j") return (current + 1) % itemCount;
  if (key === "ArrowUp" || key === "k") return (current - 1 + itemCount) % itemCount;
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  return null;
}

/**
 * Core roving-tabindex logic, independent of React. Used directly by tests;
 * the React version below reuses the same nextIndexFor resolver.
 */
export function createRovingTabIndex(itemCount: number): RovingTabIndexResult {
  let focused = 0;
  const containerRef = { current: null as HTMLDivElement | null };

  const setFocusedIndex = (index: number) => {
    focused = index;
  };

  const handleKeyDown = (event: React.KeyboardEvent | { key: string; preventDefault: () => void }) => {
    if (itemCount === 0) return;
    const next = nextIndexFor(event.key, focused, itemCount);
    if (next === null) return;
    event.preventDefault();
    focused = next;
    const target = containerRef.current?.querySelector(`[data-index="${next}"]`) as HTMLElement | null;
    target?.focus();
  };

  const getTabIndex = (index: number): 0 | -1 => (index === focused ? 0 : -1);

  return {
    containerRef,
    get focusedIndex() {
      return focused;
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
    const next = nextIndexFor(event.key, focusedRef.current, itemCount);
    if (next === null) return;
    event.preventDefault();
    focusedRef.current = next;
    setFocusedIndexState(next);
    const target = containerRef.current?.querySelector(`[data-index="${next}"]`) as HTMLElement | null;
    target?.focus();
  }, [itemCount]);

  const getTabIndex = useCallback((index: number): 0 | -1 => (index === focusedRef.current ? 0 : -1), []);

  return {
    containerRef,
    focusedIndex,
    setFocusedIndex,
    handleKeyDown,
    getTabIndex,
  };
}
