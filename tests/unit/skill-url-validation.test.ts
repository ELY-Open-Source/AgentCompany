import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolve4, resolve6 } from "node:dns/promises";
import { request } from "node:https";
import {
  buildPinnedHttpsRequestOptions,
  fetchWithSsrfProtection,
  validateSkillUrl,
} from "../../src/main/skills/url-validation";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
}));

vi.mock("node:https", () => ({
  request: vi.fn(),
}));

type RequestCall = {
  url: URL;
  options: Parameters<typeof request>[1];
};

const requestCalls: RequestCall[] = [];

function mockHttpsResponse(input: {
  statusCode: number;
  statusMessage?: string;
  headers?: Record<string, string>;
  body?: string;
}) {
  const requestMock = vi.mocked(request);
  requestMock.mockImplementationOnce((url, options, callback) => {
    requestCalls.push({ url: url as URL, options: options as RequestCall["options"] });
    const req = new EventEmitter() as ReturnType<typeof request>;
    req.end = vi.fn(() => {
      const res = new EventEmitter() as EventEmitter & {
        statusCode: number;
        statusMessage?: string;
        headers: Record<string, string>;
      };
      res.statusCode = input.statusCode;
      res.statusMessage = input.statusMessage;
      res.headers = input.headers ?? {};
      queueMicrotask(() => {
        callback?.(res as never);
        if (input.body) res.emit("data", Buffer.from(input.body));
        res.emit("end");
      });
      return req;
    }) as never;
    return req;
  });
}

describe("skill URL validation", () => {
  beforeEach(() => {
    requestCalls.length = 0;
    vi.mocked(resolve4).mockReset();
    vi.mocked(resolve6).mockReset();
    vi.mocked(request).mockReset();
  });

  it("pins the socket lookup while preserving Host and SNI", () => {
    const parsed = new URL("https://example.com/skills/SKILL.md");
    const options = buildPinnedHttpsRequestOptions(parsed, { address: "93.184.216.34", family: 4 });

    expect(options.servername).toBe("example.com");
    expect(options.headers).toEqual({ Host: "example.com" });

    let resolved: { address: string; family: number } | null = null;
    if (typeof options.lookup !== "function") throw new Error("Expected lookup function.");
    options.lookup("example.com", {}, (error, address, family) => {
      if (error) throw error;
      resolved = { address: String(address), family: Number(family) };
    });

    expect(resolved).toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("rejects non-HTTPS and private skill import URLs", () => {
    expect(() => validateSkillUrl("http://example.com/SKILL.md")).toThrow("Only HTTPS URLs are allowed");
    expect(() => validateSkillUrl("https://127.0.0.1/SKILL.md")).toThrow("Private/reserved IP addresses");
    expect(() => validateSkillUrl("https://localhost/SKILL.md")).toThrow("Private/reserved IP addresses");
  });

  it("fetchWithSsrfProtection keeps the original hostname while pinning lookup to validated IP", async () => {
    vi.mocked(resolve4).mockResolvedValue(["93.184.216.34"]);
    vi.mocked(resolve6).mockResolvedValue([]);
    mockHttpsResponse({ statusCode: 200, headers: { "content-type": "text/plain" }, body: "ok" });

    const response = await fetchWithSsrfProtection("https://example.com/skills/SKILL.md");

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ok");
    expect(requestCalls).toHaveLength(1);
    expect(requestCalls[0]?.url.hostname).toBe("example.com");
    expect(requestCalls[0]?.options).toMatchObject({
      headers: { Host: "example.com" },
      servername: "example.com",
    });

    let resolved: { address: string; family: number } | null = null;
    const lookup = requestCalls[0]?.options?.lookup;
    if (typeof lookup !== "function") throw new Error("Expected lookup function.");
    lookup("example.com", {}, (error, address, family) => {
      if (error) throw error;
      resolved = { address: String(address), family: Number(family) };
    });
    expect(resolved).toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("revalidates redirects before following them", async () => {
    vi.mocked(resolve4)
      .mockResolvedValueOnce(["93.184.216.34"])
      .mockResolvedValueOnce(["127.0.0.1"]);
    vi.mocked(resolve6).mockResolvedValue([]);
    mockHttpsResponse({
      statusCode: 302,
      headers: { location: "https://redirect.example/SKILL.md" },
    });

    await expect(fetchWithSsrfProtection("https://example.com/skills/SKILL.md"))
      .rejects
      .toThrow("DNS resolved to private IP 127.0.0.1");
    expect(requestCalls).toHaveLength(1);
    expect(requestCalls[0]?.url.hostname).toBe("example.com");
  });
});
