export function normalizeExternalBrowserUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("External URLs must use HTTPS.");
  if (url.username || url.password) throw new Error("External URLs must not include credentials.");
  return url.toString();
}
