import { useEffect, useState } from "react";

/** CSS px per font pixel so each one lands on a whole number of screen pixels: the device ratio rounded to the nearest integer (at least 1), over the ratio. */
export function pixelScale(devicePixelRatio: number): number {
  return Math.max(1, Math.round(devicePixelRatio)) / devicePixelRatio;
}

/** Keeps --px on the root in step with the display, including when the window moves to another screen. */
export function usePixelScale(): void {
  const [ratio, setRatio] = useState(() => window.devicePixelRatio);
  useEffect(() => {
    const media = window.matchMedia(`(resolution: ${ratio}dppx)`);
    const onChange = () => setRatio(window.devicePixelRatio);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [ratio]);
  useEffect(() => {
    document.documentElement.style.setProperty("--px", String(pixelScale(ratio)));
  }, [ratio]);
}
