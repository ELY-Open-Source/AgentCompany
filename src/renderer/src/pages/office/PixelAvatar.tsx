import { useEffect, useRef } from "react";
import { appearanceFor, drawPerson } from "./sprites";

const W = 24;
const H = 24;
/** Each sprite pixel shows as a 2×2 block. */
const ZOOM = 2;

/** The person as the office draws them, from the shoulders up, so a face on the org chart is the same face at the desk. */
export function PixelAvatar({ id, isCeo }: { id: string; isCeo: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const scale = ZOOM * Math.max(1, Math.ceil(window.devicePixelRatio));
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("The avatar canvas has no 2D context.");
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawPerson(ctx, W / 2, H + 10, appearanceFor(id, isCeo), { facing: "south", walkPhase: 0, working: false, carrying: null, timeMs: 0, animSeed: 0 }, isCeo);
  }, [id, isCeo]);
  return <canvas ref={ref} className="pixel-avatar" data-person={id} aria-hidden="true" style={{ width: W * ZOOM, height: H * ZOOM }} />;
}
