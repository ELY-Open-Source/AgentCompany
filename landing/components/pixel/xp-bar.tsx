"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import styles from "./pixel.module.css";

const SEGMENTS = 20;

/** A segmented XP bar that ticks up one block at a time the first time it scrolls into view. */
export function XpBar({ value, max, label }: { value: number; max: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const labelId = useId();
  const current = Math.max(0, Math.min(max, value));
  const lit = Math.round((current / max) * SEGMENTS);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setPlaying(true);
      observer.disconnect();
    });
    observer.observe(ref.current!);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={styles.xp} data-playing={playing ? "" : undefined}>
      <div className={styles.xpHead}>
        <span id={labelId}>{label}</span>
        <span className={styles.xpNumbers}>{current}/{max}</span>
      </div>
      <div
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={current}
        className={styles.xpTrack}
      >
        {Array.from({ length: SEGMENTS }, (_, index) => (
          <span
            key={index}
            className={styles.xpSegment}
            data-on={index < lit ? "" : undefined}
            style={{ "--i": index } as CSSProperties}
          />
        ))}
      </div>
    </div>
  );
}
