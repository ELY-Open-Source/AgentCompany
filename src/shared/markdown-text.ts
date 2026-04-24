const ACTUAL_LINE_BREAKS = /\r\n?/g;
const ESCAPED_CRLF = /\\r\\n/g;
const ESCAPED_LF = /\\n/g;
const ESCAPED_CR = /\\r/g;

export function normalizeMarkdownText(text: string): string {
  return text
    .replace(ACTUAL_LINE_BREAKS, "\n")
    .replace(ESCAPED_CRLF, "\n")
    .replace(ESCAPED_LF, "\n")
    .replace(ESCAPED_CR, "\n");
}
