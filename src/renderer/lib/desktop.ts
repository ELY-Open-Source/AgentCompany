import type { DesktopResult } from "@shared/contracts";

export class DesktopError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "DesktopError";
  }
}

export function unwrap<T>(result: DesktopResult<T>): T {
  if (!result.ok) {
    throw new DesktopError(result.error.code, result.error.message);
  }
  return result.data;
}
