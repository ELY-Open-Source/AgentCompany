import { resolve4, resolve6 } from "node:dns/promises";

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return false;
  if (parts[0] === 127) return true;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts.every((p) => p === 0)) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/[[\]]/g, "");
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return true;
  if (normalized.startsWith("fe80")) return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  const v4Mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Mapped && isPrivateIPv4(v4Mapped[1]!)) return true;
  return false;
}

function hasDeceptiveHostname(hostname: string): boolean {
  const first = hostname.split(".")[0] ?? "";
  if (/^0\d/.test(first)) return true;
  if (/^0x/i.test(first)) return true;
  if (/^\d+$/.test(hostname) && !hostname.includes(".")) return true;
  return false;
}

function assertPublicIps(ips: string[]): void {
  for (const ip of ips) {
    if (isPrivateIPv4(ip) || isPrivateIPv6(ip)) {
      throw new Error(`DNS resolved to private IP ${ip} — possible DNS rebinding attack`);
    }
  }
}

export function validateSkillUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error("Only HTTPS URLs are allowed for skill import");
  }
  const hostname = parsed.hostname;
  if (hasDeceptiveHostname(hostname)) {
    throw new Error("Deceptive IP format not allowed for skill import");
  }
  if (
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    isPrivateIPv4(hostname) ||
    isPrivateIPv6(hostname)
  ) {
    throw new Error("Private/reserved IP addresses are not allowed for skill import");
  }
}

/**
 * Resolve DNS and validate that all IPs are public. Returns the resolved IPv4 addresses.
 */
export async function resolveAndValidateIps(url: string): Promise<string[]> {
  validateSkillUrl(url);
  const { hostname } = new URL(url);
  const v4: string[] = [];
  const v6: string[] = [];
  try { v4.push(...(await resolve4(hostname))); } catch { /* no A records */ }
  try { v6.push(...(await resolve6(hostname))); } catch { /* no AAAA records */ }
  assertPublicIps([...v4, ...v6]);
  return v4;
}

/**
 * Fetch a URL with SSRF protection: resolve DNS once, validate IPs, then fetch
 * using a resolved IP to prevent DNS rebinding between validation and fetch.
 */
export async function fetchWithSsrfProtection(url: string): Promise<Response> {
  const resolvedIps = await resolveAndValidateIps(url);
  if (resolvedIps.length === 0) {
    throw new Error("DNS resolution returned no usable IPv4 addresses");
  }
  const parsed = new URL(url);
  const resolvedUrl = new URL(url);
  resolvedUrl.hostname = resolvedIps[0]!;
  const response = await fetch(resolvedUrl.toString(), {
    headers: { Host: parsed.host },
    redirect: "manual",
  });
  // Follow redirects manually to prevent redirect-to-private-IP attacks
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) {
      throw new Error(`Redirect ${response.status} with no Location header`);
    }
    const redirectUrl = new URL(location, url).toString();
    // Recursively validate the redirect target (prevents redirect to private IP)
    return fetchWithSsrfProtection(redirectUrl);
  }
  return response;
}

/** @deprecated Use resolveAndValidateIps or fetchWithSsrfProtection instead. */
export async function validateSkillUrlResolved(url: string): Promise<void> {
  await resolveAndValidateIps(url);
}
