/**
 * Pattern-based token redactor.
 *
 * Complements `buildRedactor` (env-value redaction) by scrubbing common
 * credential shapes out of arbitrary strings before they reach the parent
 * process — Bearer tokens, provider API keys, OAuth query params.
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
