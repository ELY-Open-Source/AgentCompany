"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "./icon";
import styles from "./pixel.module.css";

const CHAR_MS = 28;

/** A character's speech box: lines type out, ▼ blinks when one is done, a click or Enter skips ahead. */
export function NpcSay({ speaker, portrait = "bot", lines, typewriter = true }: {
  speaker: string;
  portrait?: IconName;
  lines: string[];
  typewriter?: boolean;
}) {
  const boxRef = useRef<HTMLElement>(null);
  const [line, setLine] = useState(0);
  const [shown, setShown] = useState(0);
  const [reduced, setReduced] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const text = lines[line] ?? "";
  const count = typewriter && !reduced ? Math.min(shown, text.length) : text.length;
  const done = count === text.length;
  const last = line === lines.length - 1;

  useEffect(() => {
    if (!typewriter) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setReduced(true);
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setOnScreen(true);
      observer.disconnect();
    });
    observer.observe(boxRef.current!);
    return () => observer.disconnect();
  }, [typewriter]);

  useEffect(() => {
    if (!onScreen || done) return;
    const timer = window.setTimeout(() => setShown((value) => value + 1), CHAR_MS);
    return () => window.clearTimeout(timer);
  }, [onScreen, done, shown]);

  const advance = () => {
    if (!done) return setShown(text.length);
    setLine(last ? 0 : line + 1);
    setShown(0);
  };

  return (
    <figure ref={boxRef} className={`${styles.frame} ${styles.npc}`} onClick={advance}>
      <figcaption className={styles.plate}>{speaker}</figcaption>
      <div className={styles.portrait} aria-hidden="true">
        <Icon name={portrait} size={3} />
      </div>
      <blockquote className={styles.npcText}>
        <p className={styles.visuallyHidden} aria-live="polite">{text}</p>
        <p aria-hidden="true">
          {text.slice(0, count)}
          <span className={styles.ghost}>{text.slice(count)}</span>
        </p>
      </blockquote>
      <button
        type="button"
        className={styles.advance}
        data-done={done ? "" : undefined}
        aria-label={!done ? "Show the whole line" : last ? "Hear it again" : "Next line"}
        onClick={(event) => {
          event.stopPropagation();
          advance();
        }}
      />
    </figure>
  );
}
