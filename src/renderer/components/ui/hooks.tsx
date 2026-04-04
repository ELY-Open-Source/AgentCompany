import { Component, useEffect, useRef, type ErrorInfo, type ReactNode } from "react";
import { ActionButton } from "./primitives";

/* ------------------------------------------------------------------ */
/*  useFocusTrap                                                       */
/* ------------------------------------------------------------------ */

export function useFocusTrap(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active || !ref.current) return;

    const container = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const focusableNow = container.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusableNow.length === 0) return;

      const first = focusableNow[0];
      const last = focusableNow[focusableNow.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    container.addEventListener("keydown", handleKeyDown);
    return () => {
      container.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [active]);

  return ref;
}

/* ------------------------------------------------------------------ */
/*  useReducedMotion                                                   */
/* ------------------------------------------------------------------ */

export function useReducedMotion() {
  const query = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  // Return static value — Electron doesn't change this mid-session
  return query?.matches ?? false;
}

/* ------------------------------------------------------------------ */
/*  ErrorBoundary                                                      */
/* ------------------------------------------------------------------ */

export class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
  }
  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="p-8 text-center" role="alert">
          <div className="text-[15px] font-semibold text-destructive mb-2">Something went wrong</div>
          <ActionButton label="Reload page" onClick={() => window.location.reload()} />
        </div>
      );
    }
    return this.props.children;
  }
}
