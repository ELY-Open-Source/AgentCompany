/**
 * Defensive token redactor for worker process logs.
 *
 * Pi-mono's HTTP clients are not known to log credentials, but stack traces
 * from upstream libraries (or future pi versions) could include header
 * fragments containing `Authorization: Bearer ...` or `?access_token=...`.
 * To prevent any such fragment from reaching the parent's stderr stream,
 * `installLogRedactor()` wraps `console.error`, `console.warn`, `console.log`,
 * `process.stdout.write`, and `process.stderr.write` so that every string
 * argument is filtered through `redactTokens()` before transmission.
 */

const PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /Bearer\s+[A-Za-z0-9._\-+/=]{8,}/g, replacement: "Bearer [REDACTED]" },
  { pattern: /(authorization\s*[:=]\s*)([^\s,;]{8,})/gi, replacement: "$1[REDACTED]" },
  { pattern: /(access_token=)([^&\s"']+)/gi, replacement: "$1[REDACTED]" },
  { pattern: /(refresh_token=)([^&\s"']+)/gi, replacement: "$1[REDACTED]" },
  { pattern: /(api[_-]?key\s*[:=]\s*['"]?)([A-Za-z0-9._-]{12,})/gi, replacement: "$1[REDACTED]" },
  { pattern: /sk-(?:ant-)?[A-Za-z0-9_-]{16,}/g, replacement: "sk-[REDACTED]" },
  { pattern: /ghp_[A-Za-z0-9]{16,}/g, replacement: "ghp_[REDACTED]" },
  { pattern: /gho_[A-Za-z0-9]{16,}/g, replacement: "gho_[REDACTED]" },
  { pattern: /AKIA[A-Z0-9]{16}/g, replacement: "AKIA[REDACTED]" },
];

export function redactTokens(text: string): string {
  let result = text;
  for (const { pattern, replacement } of PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function redactArg(arg: unknown): unknown {
  if (typeof arg === "string") return redactTokens(arg);
  if (arg instanceof Error) {
    const redacted = new Error(redactTokens(arg.message));
    redacted.name = arg.name;
    if (arg.stack) redacted.stack = redactTokens(arg.stack);
    return redacted;
  }
  return arg;
}

interface InstallTarget {
  console: { log: typeof console.log; warn: typeof console.warn; error: typeof console.error; info: typeof console.info };
  stdoutWrite: typeof process.stdout.write;
  stderrWrite: typeof process.stderr.write;
}

export function installLogRedactor(target?: Partial<InstallTarget>): () => void {
  const cons = target?.console ?? console;
  const origLog = cons.log.bind(cons);
  const origWarn = cons.warn.bind(cons);
  const origError = cons.error.bind(cons);
  const origInfo = cons.info.bind(cons);

  cons.log = (...args: unknown[]) => origLog(...args.map(redactArg));
  cons.warn = (...args: unknown[]) => origWarn(...args.map(redactArg));
  cons.error = (...args: unknown[]) => origError(...args.map(redactArg));
  cons.info = (...args: unknown[]) => origInfo(...args.map(redactArg));

  const stdoutWriteOrig = (target?.stdoutWrite ?? process.stdout.write).bind(process.stdout);
  const stderrWriteOrig = (target?.stderrWrite ?? process.stderr.write).bind(process.stderr);
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (typeof chunk === "string") return stdoutWriteOrig(redactTokens(chunk), ...rest as never[]);
    return stdoutWriteOrig(chunk as never, ...rest as never[]);
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (typeof chunk === "string") return stderrWriteOrig(redactTokens(chunk), ...rest as never[]);
    return stderrWriteOrig(chunk as never, ...rest as never[]);
  }) as typeof process.stderr.write;

  return () => {
    cons.log = origLog;
    cons.warn = origWarn;
    cons.error = origError;
    cons.info = origInfo;
    process.stdout.write = stdoutWriteOrig;
    process.stderr.write = stderrWriteOrig;
  };
}
