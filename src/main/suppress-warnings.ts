/**
 * Silences the `node:sqlite` ExperimentalWarning emitted on first import.
 * Must be imported before any module that touches `node:sqlite`, otherwise
 * the warning has already fired.
 *
 * Targeted: only the SQLite experimental warning. All other warnings pass
 * through unchanged.
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
