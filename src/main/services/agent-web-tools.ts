import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { requireString } from "./agent-tool-args";
import { currentRunSignal, stopReasonOf } from "./run-control";
import type { ToolCall, ToolDefinition } from "./provider-tool-turn";
import { PAGE_TOOL_PROPERTIES, pageText, readPageArgs, type PageRequest } from "./text-paging";

const FETCH_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 2_000_000;
const SEARCH_RESULT_LIMIT = 8;
const STATUS_EXCERPT_CHARS = 300;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AgentCompany/1.0";

/** Subset of the fetch contract the tools rely on; injectable so tests stay off the network. */
export type WebFetcher = (url: string, init: { headers: Record<string, string>; redirect: "manual"; signal: AbortSignal }) => Promise<Response>;

/**
 * Every agent carries live web access by default: web_search (keyless
 * DuckDuckGo HTML backend) and fetch_url (readable text extraction). The
 * doctrine is "be ashamed to guess, be proud to look things up" — an agent
 * that can browse verifies APIs and facts instead of inventing them.
 *
 * These tools run on the operator's machine, so every request is guarded
 * against SSRF: hostnames resolve before connecting and private, loopback,
 * link-local, and reserved ranges are refused — re-checked on every redirect
 * hop.
 */
export const WEB_TOOLS: ToolDefinition[] = [
  {
    name: "web_search",
    description: "Search the live web. Use it to look up APIs, libraries, prices, competitors, and current facts instead of guessing. Returns titles, URLs, and snippets — follow up with fetch_url to read a promising result in full.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", description: "The search query." },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_url",
    description: "Fetch a public web page and return its readable text — whole, a range of lines, or only the lines matching a search. A long page tells you which start_line continues it. Use after web_search, or on any URL you were given. Only public hosts are reachable.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: { type: "string", description: "Absolute http(s) URL to fetch." },
        ...PAGE_TOOL_PROPERTIES,
      },
      required: ["url"],
    },
  },
];

const WEB_TOOL_NAMES = new Set(WEB_TOOLS.map((tool) => tool.name));

export function isWebTool(name: string): boolean {
  return WEB_TOOL_NAMES.has(name);
}

export async function executeWebTool(call: ToolCall, fetcher: WebFetcher = fetch): Promise<string> {
  try {
    switch (call.name) {
      case "web_search":
        return await webSearch(requireString(call.arguments.query, "query"), fetcher);
      case "fetch_url":
        return await fetchUrl(requireString(call.arguments.url, "url"), readPageArgs(call.arguments), fetcher);
      default:
        throw new Error(`Unknown web tool "${call.name}".`);
    }
  } catch (error) {
    return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function webSearch(query: string, fetcher: WebFetcher): Promise<string> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const body = await guardedFetch(url, fetcher);
  const results = parseSearchResults(body.text);
  if (results.length === 0) {
    throw new Error("The search returned no parseable results — the backend may have blocked the request or changed its markup. Try fetch_url on a known site instead.");
  }
  return results
    .slice(0, SEARCH_RESULT_LIMIT)
    .map((result, index) => `${index + 1}. ${result.title}\n   ${result.url}${result.snippet ? `\n   ${result.snippet}` : ""}`)
    .join("\n\n");
}

async function fetchUrl(rawUrl: string, page: PageRequest, fetcher: WebFetcher): Promise<string> {
  const body = await guardedFetch(rawUrl, fetcher);
  const text = looksLikeHtml(body.contentType, body.text) ? htmlToText(body.text) : body.text.trim();
  if (!text) return `${body.finalUrl} returned an empty page (status ${body.status}).`;
  return `${body.finalUrl} (status ${body.status})\n\n${pageText(body.finalUrl, text, page)}`;
}

interface GuardedResponse {
  status: number;
  contentType: string;
  finalUrl: string;
  text: string;
}

/** Fetches with the SSRF guard applied to the initial URL and every redirect hop. */
async function guardedFetch(rawUrl: string, fetcher: WebFetcher): Promise<GuardedResponse> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const url = parseHttpUrl(current);
    await assertPublicHost(url.hostname);
    // The limit covers headers and body; a stopped run aborts the fetch too.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), FETCH_TIMEOUT_MS);
    const runSignal = currentRunSignal();
    const signal = runSignal ? AbortSignal.any([timeout.signal, runSignal]) : timeout.signal;
    let response: Response;
    let text = "";
    let redirect: string | null = null;
    try {
      response = await fetcher(url.toString(), {
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain,*/*" },
        redirect: "manual",
        signal,
      });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        redirect = new URL(location, url).toString();
        await response.body?.cancel();
      } else {
        text = await readBodyCapped(response);
      }
    } catch (error) {
      const reason = runSignal?.aborted ? stopReasonOf(runSignal) : timeout.signal.aborted ? `no answer within ${FETCH_TIMEOUT_MS / 1000}s.` : error instanceof Error ? error.message : String(error);
      throw new Error(`Fetching ${url.hostname} failed: ${reason}`);
    } finally {
      clearTimeout(timer);
    }
    if (redirect) {
      current = redirect;
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`${url.toString()} answered with status ${response.status}: ${statusExcerpt(response.headers.get("content-type") ?? "", text)}`);
    }
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      finalUrl: url.toString(),
      text,
    };
  }
  throw new Error(`Too many redirects (more than ${MAX_REDIRECTS}).`);
}

/** The start of an error page, as one line, so the agent sees why without the whole page. */
function statusExcerpt(contentType: string, text: string): string {
  const plain = (looksLikeHtml(contentType, text) ? htmlToText(text) : text).replace(/\s+/g, " ").trim();
  return plain ? plain.slice(0, STATUS_EXCERPT_CHARS) : "(empty body)";
}

function parseHttpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`"${rawUrl}" is not a valid absolute URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http(s) URLs are allowed, got "${url.protocol}".`);
  }
  return url;
}

/** Refuses hosts that resolve to loopback, private, link-local, or otherwise non-public addresses. */
async function assertPublicHost(hostname: string): Promise<void> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (isIP(bare)) {
    if (isPrivateAddress(bare)) throw new Error(`Refusing to fetch non-public address "${bare}".`);
    return;
  }
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(bare, { all: true });
  } catch {
    throw new Error(`Could not resolve host "${bare}".`);
  }
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) throw new Error(`Refusing to fetch "${bare}" — it resolves to the non-public address ${address}.`);
  }
}

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1]);
    return lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb");
  }
  const octets = ip.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet))) return true;
  const [a, b] = octets;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

async function readBodyCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (bytes >= MAX_RESPONSE_BYTES) {
      await reader.cancel();
      break;
    }
  }
  return text + decoder.decode();
}

function looksLikeHtml(contentType: string, text: string): boolean {
  if (contentType.includes("html")) return true;
  return /<\s*(!doctype|html|body|div|p)\b/i.test(text.slice(0, 2000));
}

/** Dependency-free readable-text extraction: good enough to study a page, not a browser. */
export function htmlToText(html: string): string {
  const withoutBlocks = html
    .replace(/<script[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const withBreaks = withoutBlocks
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|pre)\s*>/gi, "\n")
    .replace(/<(br|hr)\s*\/?\s*>/gi, "\n");
  const withoutTags = withBreaks.replace(/<[^>]+>/g, " ");
  return decodeEntities(withoutTags)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line, index, lines) => line.length > 0 || (index > 0 && lines[index - 1].length > 0))
    .join("\n")
    .trim();
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"' };
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
}

function safeCodePoint(code: number): string {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Parses DuckDuckGo's HTML endpoint. Result links carry class "result__a";
 * their hrefs are usually /l/?uddg=<encoded-target> redirects, which are
 * unwrapped to the real URL. Snippets carry class "result__snippet".
 */
export function parseSearchResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const anchorPattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetPattern = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(a|td|div|span)>/gi;
  const snippets: string[] = [];
  for (let match = snippetPattern.exec(html); match; match = snippetPattern.exec(html)) {
    snippets.push(htmlToText(match[1]));
  }
  for (let match = anchorPattern.exec(html); match; match = anchorPattern.exec(html)) {
    const target = unwrapDuckDuckGoHref(decodeEntities(match[1]));
    if (!target) continue;
    results.push({
      title: htmlToText(match[2]) || target,
      url: target,
      snippet: snippets[results.length] ?? "",
    });
  }
  return results;
}

function unwrapDuckDuckGoHref(href: string): string | null {
  const absolute = href.startsWith("//") ? `https:${href}` : href;
  try {
    const url = new URL(absolute, "https://duckduckgo.com");
    const wrapped = url.searchParams.get("uddg");
    if (wrapped) return decodeURIComponent(wrapped);
    if (url.hostname.endsWith("duckduckgo.com") && url.pathname.startsWith("/l/")) return null;
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
