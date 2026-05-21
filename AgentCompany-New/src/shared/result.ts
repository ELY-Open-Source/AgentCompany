export interface DesktopError {
  code: string;
  message: string;
}

export type DesktopResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: DesktopError };

export function ok<T>(data: T): DesktopResult<T> {
  return { ok: true, data };
}

export function fail(code: string, message: string): DesktopResult<never> {
  return { ok: false, error: { code, message } };
}
