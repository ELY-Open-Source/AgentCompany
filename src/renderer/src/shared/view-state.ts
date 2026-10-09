import { useState } from "react";

/** Where the operator was, by key; seeded once from the first snapshot and written through to the profile. */
let saved: Record<string, unknown> | null = null;

export function seedViewState(initial: Record<string, unknown>): void {
  if (saved === null) saved = { ...initial };
}

export function readViewState<T>(key: string, isValid: (value: unknown) => value is T): T | undefined {
  if (saved === null) throw new Error("View state was read before the first snapshot.");
  const value = saved[key];
  return isValid(value) ? value : undefined;
}

export function writeViewState(key: string, value: unknown): void {
  if (saved === null) throw new Error("View state was written before the first snapshot.");
  saved[key] = value;
  void window.agentCompany.saveViewState({ key, value }).then((result) => {
    if (!result.ok) console.error(`[view-state] ${key} was not remembered: ${result.error.message}`);
  });
}

/** State that survives page switches and restarts; a stored value that no longer fits falls back. `override` wins when a page is opened for an object. */
export function usePersistentState<T>(key: string, fallback: T, isValid: (value: unknown) => value is T, override?: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => override ?? readViewState(key, isValid) ?? fallback);
  const set = (next: T) => {
    setValue(next);
    writeViewState(key, next);
  };
  return [value, set];
}

export const oneOf = <T extends string>(values: readonly T[]) => (value: unknown): value is T =>
  typeof value === "string" && (values as readonly string[]).includes(value);

export const isIdOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
