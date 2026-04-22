import {
  classifyConsoleErrorSuppression,
  classifyWarningSuppression,
} from "./main-warning-suppression-rules";

const originalEmitWarning = process.emitWarning.bind(process);

process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
  if (classifyWarningSuppression(warning)) return;
  return (originalEmitWarning as (...args: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

const originalConsoleError = console.error.bind(console);

console.error = ((...args: unknown[]) => {
  if (classifyConsoleErrorSuppression(args)) return;
  return originalConsoleError(...args);
}) as typeof console.error;
