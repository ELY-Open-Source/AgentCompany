import { resolve4, resolve6 } from "node:dns/promises";
import { request, type RequestOptions } from "node:https";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import type { LookupFunction } from "node:net";

interface ResolvedIpRecord {
  address: string;
  family: 4 | 6;
}

const MAX_REDIRECT_HOPS = 5;

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
  return (await resolveAndValidateIpRecords(url))
    .filter((record) => record.family === 4)
    .map((record) => record.address);
}

async function resolveAndValidateIpRecords(url: string): Promise<ResolvedIpRecord[]> {
  validateSkillUrl(url);
  const { hostname } = new URL(url);
  const v4: string[] = [];
  const v6: string[] = [];
  try { v4.push(...(await resolve4(hostname))); } catch { /* no A records */ }
  try { v6.push(...(await resolve6(hostname))); } catch { /* no AAAA records */ }
  assertPublicIps([...v4, ...v6]);
  return [
    ...v4.map((address): ResolvedIpRecord => ({ address, family: 4 })),
    ...v6.map((address): ResolvedIpRecord => ({ address, family: 6 })),
  ];
}

function buildHeaders(headers: IncomingHttpHeaders): Headers {
  const out = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) out.append(key, entry);
    } else if (value !== undefined) {
      out.set(key, value);
    }
  }
  return out;
}

function readBody(response: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    response.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    response.on("end", () => resolve(Buffer.concat(chunks)));
    response.on("error", reject);
  });
}

export function buildPinnedHttpsRequestOptions(
  parsed: URL,
  ip: ResolvedIpRecord,
): RequestOptions {
  const lookup: LookupFunction = (_hostname, _options, callback) => {
    callback(null, ip.address, ip.family);
  };
  return {
    method: "GET",
    headers: { Host: parsed.host },
    servername: parsed.hostname,
    lookup,
  };
}

async function fetchHttpsWithResolvedIp(url: string, ip: ResolvedIpRecord): Promise<Response> {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request(parsed, buildPinnedHttpsRequestOptions(parsed, ip), async (res) => {
      try {
        const body = await readBody(res);
        const arrayBuffer = new ArrayBuffer(body.byteLength);
        new Uint8Array(arrayBuffer).set(body);
        resolve(new Response(arrayBuffer, {
          status: res.statusCode ?? 500,
          statusText: res.statusMessage,
          headers: buildHeaders(res.headers),
        }));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * Fetch a URL with SSRF protection: resolve DNS once, validate IPs, then keep
 * the original hostname for Host/SNI while pinning the socket lookup to a
 * validated IP.
 */
export async function fetchWithSsrfProtection(
  url: string,
  state: { visited: Set<string>; hops: number; chain: string[] } = {
    visited: new Set<string>(),
    hops: 0,
    chain: [],
  },
): Promise<Response> {
  if (state.visited.has(url)) {
    throw new Error(`Redirect loop detected while importing skill: ${[...state.chain, url].join(" -> ")}`);
  }
  if (state.hops > MAX_REDIRECT_HOPS) {
    throw new Error(`Too many redirects while importing skill: ${[...state.chain, url].join(" -> ")}`);
  }
  state.visited.add(url);
  state.chain.push(url);
  const resolvedIps = await resolveAndValidateIpRecords(url);
  if (resolvedIps.length === 0) {
    throw new Error("DNS resolution returned no usable addresses");
  }
  const response = await fetchHttpsWithResolvedIp(url, resolvedIps[0]!);
  // Follow redirects manually to prevent redirect-to-private-IP attacks
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) {
      throw new Error(`Redirect ${response.status} with no Location header`);
    }
    const redirectUrl = new URL(location, url).toString();
    return fetchWithSsrfProtection(redirectUrl, {
      visited: state.visited,
      hops: state.hops + 1,
      chain: state.chain,
    });
  }
  return response;
}

/** @deprecated Use resolveAndValidateIps or fetchWithSsrfProtection instead. */
export async function validateSkillUrlResolved(url: string): Promise<void> {
  await resolveAndValidateIps(url);
}
