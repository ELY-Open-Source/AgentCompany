"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./section.module.css";

type RevealState = "static" | "armed" | "shown";

/** Wipes its children in, scanline by scanline, the first time they scroll into view; the unclipped outer box is what gets observed. */
export function Reveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<RevealState>("static");

  useEffect(() => {
    const element = ref.current!;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (element.getBoundingClientRect().top < window.innerHeight) return;
    setState("armed");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry!.isIntersecting) return;
        setState("shown");
        observer.disconnect();
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref}>
      <div className={styles.reveal} data-reveal={state}>
        {children}
      </div>
    </div>
  );
}
