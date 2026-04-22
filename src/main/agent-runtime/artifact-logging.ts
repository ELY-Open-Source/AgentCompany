import { logAppError, type Logger } from "../errors/index.js";

const DEFAULT_ARTIFACT_LOGGER: Logger = console;

export type { Logger };

export function logArtifactFsError(
  logger: Logger | undefined,
  error: unknown,
  code: string,
  message: string,
  context: Record<string, unknown>,
): void {
  logAppError(
    logger ?? DEFAULT_ARTIFACT_LOGGER,
    error,
    {
      kind: "recoverable",
      code,
      message,
      context,
    },
    "warn",
  );
}
