"use client";

import { useEffect, useRef, useState } from "react";
import { dayPartAt, paletteFor, seasonAt, type DayPart, type Season } from "../../lib/palette";
import styles from "./world.module.css";

const DAY_PARTS: readonly DayPart[] = ["dawn", "day", "dusk", "night"];
const SEASONS: readonly Season[] = ["spring", "summer", "autumn", "winter"];
const TOWERS = [34, 52, 28, 70, 44, 86, 38, 58, 30, 64, 48, 76, 36, 54];

function attribute<T extends string>(name: string, allowed: readonly T[], clock: T): T {
  const value = document.documentElement.getAttribute(name);
  if (value === null) return clock;
  if (!allowed.includes(value as T)) throw new Error(`PixelWorld: unknown ${name} "${value}"`);
  return value as T;
}

function webglAvailable(): boolean {
  const gl = document.createElement("canvas").getContext("webgl2");
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  return gl !== null;
}

function Skyline() {
  return (
    <div className={styles.fallback} aria-hidden="true">
      {[0, 1, 2, 3].map((band) => (
        <div key={band} className={styles.band} style={{ background: `var(--ink-sky-${band})` }} />
      ))}
      <div className={styles.skyline}>
        {TOWERS.map((height, index) => (
          <div key={index} className={styles.tower} style={{ height: `${height}%` }} />
        ))}
      </div>
    </div>
  );
}

/** Hero diorama of the AgentCompany office, re-lit live whenever the site palette rotates. */
export function PixelWorld({ className, focus = "center" }: { className?: string; focus?: "center" | "right" }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const focusRef = useRef(focus);
  const reframeRef = useRef<(() => void) | null>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    focusRef.current = focus;
    reframeRef.current?.();
  }, [focus]);

  useEffect(() => {
    if (!webglAvailable()) {
      setFallback(true);
      return;
    }
    const frame = frameRef.current!;
    const canvas = canvasRef.current!;
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    void import("./engine").then(({ createWorld }) => {
      if (cancelled) return;
      const world = createWorld(canvas);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      let visible = false;
      let running = false;

      const refresh = () => {
        running = !reduced && visible && !document.hidden;
        world.setRunning(running);
        if (!running) world.render();
      };
      const repaint = () => {
        const now = new Date();
        const part = attribute("data-daypart", DAY_PARTS, dayPartAt(now));
        world.setPalette(paletteFor(part, attribute("data-season", SEASONS, seasonAt(now))), part);
        if (!running) world.render();
      };
      const fit = () => {
        world.setFocusRight(focusRef.current === "right" && frame.clientWidth > 900);
        world.resize(frame.clientWidth, frame.clientHeight);
      };
      const resize = () => {
        fit();
        if (!running) world.render();
      };
      const point = (event: PointerEvent) => world.setPointer((event.clientX / window.innerWidth) * 2 - 1, (event.clientY / window.innerHeight) * 2 - 1);
      const scroll = () => world.setScroll(Math.min(1, Math.max(0, window.scrollY / Math.max(1, frame.clientHeight))));

      fit();
      repaint();
      reframeRef.current = resize;
      const sizes = new ResizeObserver(resize);
      sizes.observe(frame);
      const palette = new MutationObserver(repaint);
      palette.observe(document.documentElement, { attributes: true, attributeFilter: ["data-daypart", "data-season"] });
      const sight = new IntersectionObserver(([entry]) => {
        visible = entry!.isIntersecting;
        refresh();
      });
      sight.observe(frame);
      document.addEventListener("visibilitychange", refresh);
      if (!reduced) {
        window.addEventListener("pointermove", point, { passive: true });
        window.addEventListener("scroll", scroll, { passive: true });
      }
      refresh();

      cleanup = () => {
        reframeRef.current = null;
        sizes.disconnect();
        palette.disconnect();
        sight.disconnect();
        document.removeEventListener("visibilitychange", refresh);
        window.removeEventListener("pointermove", point);
        window.removeEventListener("scroll", scroll);
        world.dispose();
      };
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return (
    <div ref={frameRef} className={className ? `${styles.frame} ${className}` : styles.frame}>
      {fallback ? <Skyline /> : <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />}
    </div>
  );
}
