"use client";

import { useEffect, useRef } from "react";

const glyphs = " .'`^,:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";

function parseRgbHex(hex: string): [number, number, number] {
  const value = hex.replace("#", "").trim();
  if (value.length !== 6) return [128, 128, 128];
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

export function AsciiBackground({
  cssVar = "--accent",
  baseOpacity = 0.08,
  speed = 1,
}: {
  cssVar?: string;
  baseOpacity?: number;
  speed?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    let width = 0;
    let height = 0;
    let rgb: [number, number, number] = [128, 128, 128];
    let phase = 0;
    let frame = 0;
    let isVisible = true;
    const pointer = { x: -9999, y: -9999 };

    const updateColor = () => {
      const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
      if (value.startsWith("#")) {
        rgb = parseRgbHex(value);
      }
    };

    updateColor();

    const mutationObserver = new MutationObserver(updateColor);
    mutationObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        isVisible = entry?.isIntersecting ?? true;
      },
      { threshold: 0 },
    );
    intersectionObserver.observe(container);

    const resize = () => {
      width = container.clientWidth;
      height = container.clientHeight;
      const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * devicePixelRatio;
      canvas.height = height * devicePixelRatio;
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    };

    const handlePointer = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
    };

    const render = () => {
      frame = requestAnimationFrame(render);
      if (!isVisible) return;

      context.clearRect(0, 0, width, height);
      context.font = "14px monospace";
      context.textAlign = "center";
      context.textBaseline = "middle";

      const columns = Math.ceil(width / 14);
      const rows = Math.ceil(height / 14);
      const [red, green, blue] = rgb;
      const pointerX = pointer.x;
      const pointerY = pointer.y;

      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const centerX = column * 14 + 7;
          const centerY = row * 14 + 7;
          const value =
            Math.sin(0.05 * column + phase) * Math.cos(0.05 * row + phase) +
            Math.sin(0.012 * column - 0.7 * phase) * Math.cos(0.1 * row) * 0.5;

          if (Math.abs(value) < 0.3) continue;

          const index = Math.floor(Math.abs(value) * glyphs.length);
          let glyph = glyphs[index % glyphs.length];
          if (!glyph.trim()) continue;

          let alpha = Math.abs(value) * baseOpacity;
          const deltaX = centerX - pointerX;
          const deltaY = centerY - pointerY;
          const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

          if (distance < 110) {
            const intensity = 1 - distance / 110;
            glyph = Math.random() > 0.5 ? "0" : "1";
            alpha = 0.35 * intensity;
            const drift = distance > 1 ? 7 * intensity : 0;
            const offsetX = (deltaX / distance) * drift;
            const offsetY = (deltaY / distance) * drift;
            context.fillStyle = `rgba(${red},${green},${blue},${alpha})`;
            context.fillText(glyph, centerX - offsetX, centerY - offsetY);
          } else {
            context.fillStyle = `rgba(${red},${green},${blue},${alpha})`;
            context.fillText(glyph, centerX, centerY);
          }
        }
      }

      phase += 0.005 * speed;
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", handlePointer);
    render();

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handlePointer);
      mutationObserver.disconnect();
      intersectionObserver.disconnect();
    };
  }, [baseOpacity, cssVar, speed]);

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
}
