/**
 * Silences two Electron/Node sources of stderr spam that are pure
 * lifecycle noise, not logic bugs:
 *
 * 1. `node:sqlite` ExperimentalWarning on first import — emitted by the
 *    Node runtime itself. Must be installed before any module touches
 *    `node:sqlite`, or the warning has already fired.
 *
 * 2. `Error sending from webFrameMain:` — emitted by Electron's own
 *    `WebFrameMain.prototype.send` when the renderer frame was disposed
 *    mid-send (window close, dev HMR, reload). Electron catches the
 *    native exception internally and `console.error`s it; the send is
 *    already a no-op by the time our `webContents.send` returns, and
 *    nothing downstream reads the message. With every agent-event fan
 *    out producing two sends, a single dead renderer floods the log
 *    with thousands of copies and can stall the main event loop on
 *    synchronous stderr I/O. We filter only this specific prefix so
 *    real console errors still surface.
 *
 * Targeted: everything else passes through unchanged.
 */

const originalEmitWarning = process.emitWarning.bind(process);

function isSqliteExperimentalWarning(warning: unknown): boolean {
  if (typeof warning === "string") {
    return /SQLite is an experimental feature/.test(warning);
  }
  if (warning instanceof Error) {
    return warning.name === "ExperimentalWarning" && /SQLite/.test(warning.message);
  }
  return false;
}

process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
  if (isSqliteExperimentalWarning(warning)) return;
  return (originalEmitWarning as (...args: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

const originalConsoleError = console.error.bind(console);

function isDisposedWebFrameNoise(args: unknown[]): boolean {
  if (args.length === 0) return false;
  const first = args[0];
  if (typeof first !== "string") return false;
  if (!first.startsWith("Error sending from webFrameMain")) return false;
  // Only swallow when the accompanying error is the disposal signal;
  // any other payload surfaces normally so genuine IPC failures still
  // show up in logs.
  const payload = args[1];
  const message = payload instanceof Error ? payload.message : String(payload ?? "");
  return message.includes("Render frame was disposed");
}

console.error = ((...args: unknown[]) => {
  if (isDisposedWebFrameNoise(args)) return;
  return originalConsoleError(...args);
}) as typeof console.error;
