import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BrowserWindow, Rectangle } from "electron";

interface StoredWindowState {
  bounds: Rectangle;
  maximized: boolean;
}

const DEFAULT_BOUNDS: Rectangle = {
  width: 1480,
  height: 980,
  x: 120,
  y: 80,
};

function safeParseState(filePath: string): StoredWindowState | null {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredWindowState>;
    if (!parsed.bounds || typeof parsed.bounds !== "object") return null;
    const { width, height, x, y } = parsed.bounds as Partial<Rectangle>;
    if (![width, height].every((value) => typeof value === "number" && Number.isFinite(value))) {
      return null;
    }
    return {
      bounds: {
        width: width!,
        height: height!,
        x: typeof x === "number" && Number.isFinite(x) ? x : DEFAULT_BOUNDS.x,
        y: typeof y === "number" && Number.isFinite(y) ? y : DEFAULT_BOUNDS.y,
      },
      maximized: parsed.maximized === true,
    };
  } catch {
    return null;
  }
}

function writeState(filePath: string, state: StoredWindowState) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function loadWindowState(filePath: string) {
  return safeParseState(filePath) ?? {
    bounds: DEFAULT_BOUNDS,
    maximized: false,
  };
}

export function attachWindowStatePersistence(win: BrowserWindow, filePath: string) {
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const persist = () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      saveTimer = null;
      writeState(filePath, {
        bounds: win.getBounds(),
        maximized: win.isMaximized(),
      });
    }, 250);
  };

  win.on("resize", persist);
  win.on("move", persist);
  win.on("maximize", persist);
  win.on("unmaximize", persist);
  win.on("close", () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    writeState(filePath, {
      bounds: win.getBounds(),
      maximized: win.isMaximized(),
    });
  });
}
