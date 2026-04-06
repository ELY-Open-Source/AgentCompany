export const REDACTED_HOME_PATH_USER = "[]";

const HOME_PATH_PATTERNS = [
  {
    regex: /\/Users\/[^/\\\s]+/g,
    replace: `/Users/${REDACTED_HOME_PATH_USER}`,
  },
  {
    regex: /\/home\/[^/\\\s]+/g,
    replace: `/home/${REDACTED_HOME_PATH_USER}`,
  },
  {
    regex: /([A-Za-z]:\\Users\\)[^\\/\s]+/g,
    replace: `$1${REDACTED_HOME_PATH_USER}`,
  },
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function redactHomePathUserSegments(text: string): string {
  let result = text;
  for (const pattern of HOME_PATH_PATTERNS) {
    result = result.replace(pattern.regex, pattern.replace);
  }
  return result;
}

export function redactHomePathUserSegmentsInValue<T>(value: T): T {
  if (typeof value === "string") {
    return redactHomePathUserSegments(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactHomePathUserSegmentsInValue(entry)) as T;
  }
  if (!isPlainObject(value)) {
    return value;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    redacted[key] = redactHomePathUserSegmentsInValue(entry);
  }
  return redacted as T;
}

