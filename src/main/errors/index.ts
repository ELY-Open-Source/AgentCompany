/**
 * Error taxonomy entry point (C6.1).
 *
 * Re-exports the AppError hierarchy and helpers. Import from this path
 * everywhere inside src/main/ so the rest of the tree never reaches
 * directly into `./taxonomy.ts` or `./handlers.ts`.
 */

export {
  AppError,
  RecoverableError,
  UserInputError,
  UpstreamError,
  FatalError,
  classifyUnknownError,
  isAppError,
  type AppErrorMeta,
  type ErrorKind,
} from "./taxonomy.js";

export { logAppError, type Logger } from "./handlers.js";
