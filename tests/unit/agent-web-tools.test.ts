import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { executeWebTool, htmlToText, isWebTool, parseSearchResults, WEB_TOOLS, type WebFetcher } from "../../src/main/services/agent-web-tools";
import type { ToolCall } from "../../src/main/services/provider-tool-turn";

function call(name: string, args: Record<string, unknown>): ToolCall {
  return { id: `call_${randomUUID()}`, name, arguments: args };
}

function fetcherReturning(responses: Array<{ status?: number; headers?: Record<string, string>; body?: string }>): { fetcher: WebFetcher; requested: string[] } {
  const requested: string[] = [];
  const fetcher: WebFetcher = async (url) => {
    requested.push(url);
    const next = responses.shift() ?? { status: 404, body: "not found" };
    return new Response(next.body ?? "", { status: next.status ?? 200, headers: next.headers ?? { "content-type": "text/html" } });
  };
  return { fetcher, requested };
}

const DDG_PAGE = `
<div class="result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs&amp;rut=abc">Example <b>Docs</b></a>
  <a class="result__snippet" href="#">The official documentation for Example.</a>
</div>
<div class="result">
  <a rel="nofollow" class="result__a" href="https://other.example.org/page">Other page</a>
  <a class="result__snippet" href="#">A second result snippet.</a>
</div>`;

describe("agent web tools", () => {
  test("registers both tools and recognises them by name", () => {
    expect(WEB_TOOLS.map((tool) => tool.name)).toEqual(["web_search", "fetch_url"]);
    expect(isWebTool("web_search")).toBe(true);
    expect(isWebTool("run_command")).toBe(false);
  });

  test("fetch_url refuses non-public hosts without ever connecting", async () => {
    const { fetcher, requested } = fetcherReturning([]);
    for (const url of [
      "http://127.0.0.1/admin",
      "http://10.0.0.8/x",
      "http://192.168.1.1/router",
      "http://169.254.169.254/latest/meta-data",
      "http://172.20.3.4/internal",
      "http://[::1]/x",
      "file:///etc/passwd",
    ]) {
      const output = await executeWebTool(call("fetch_url", { url }), fetcher);
      expect(output, url).toContain("ERROR");
    }
    expect(requested).toEqual([]);
  });

  test("fetch_url extracts readable text from HTML", async () => {
    const { fetcher } = fetcherReturning([{
      body: "<html><head><style>.x{}</style><script>alert(1)</script></head><body><h1>Pricing &amp; Plans</h1><p>From $9/mo</p></body></html>",
    }]);
    const output = await executeWebTool(call("fetch_url", { url: "http://93.184.216.34/pricing" }), fetcher);
    expect(output).toContain("Pricing & Plans");
    expect(output).toContain("From $9/mo");
    expect(output).not.toContain("alert(1)");
    expect(output).toContain("status 200");
  });

  test("fetch_url follows public redirects but refuses a hop into a private range", async () => {
    const followed = fetcherReturning([
      { status: 302, headers: { location: "http://93.184.216.35/final" } },
      { body: "<p>landed</p>" },
    ]);
    const output = await executeWebTool(call("fetch_url", { url: "http://93.184.216.34/start" }), followed.fetcher);
    expect(output).toContain("landed");
    expect(followed.requested).toHaveLength(2);

    const bounced = fetcherReturning([
      { status: 302, headers: { location: "http://169.254.169.254/creds" } },
    ]);
    const blocked = await executeWebTool(call("fetch_url", { url: "http://93.184.216.34/start" }), bounced.fetcher);
    expect(blocked).toContain("ERROR");
    expect(bounced.requested).toHaveLength(1);
  });

  test("fetch_url truncates oversized pages with an honest note", async () => {
    const { fetcher } = fetcherReturning([{ body: `<p>${"word ".repeat(9000)}</p>` }]);
    const output = await executeWebTool(call("fetch_url", { url: "http://93.184.216.34/big" }), fetcher);
    expect(output).toContain("[truncated: showing the first");
  });

  test("web_search parses DuckDuckGo results and unwraps redirect hrefs", async () => {
    const { fetcher } = fetcherReturning([{ body: DDG_PAGE }]);
    const output = await executeWebTool(call("web_search", { query: "example docs" }), fetcher);
    expect(output).toContain("Example Docs");
    expect(output).toContain("https://example.com/docs");
    expect(output).toContain("The official documentation for Example.");
    expect(output).toContain("https://other.example.org/page");
  });

  test("web_search reports honestly when nothing parses", async () => {
    const { fetcher } = fetcherReturning([{ body: "<html><body>blocked</body></html>" }]);
    const output = await executeWebTool(call("web_search", { query: "anything" }), fetcher);
    expect(output).toContain("ERROR");
    expect(output).toContain("no parseable results");
  });

  test("htmlToText and parseSearchResults are exported pure helpers", () => {
    expect(htmlToText("<p>a&nbsp;b</p><p>c &#169; d</p>")).toBe("a b\nc © d");
    const results = parseSearchResults(DDG_PAGE);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ title: "Example Docs", url: "https://example.com/docs" });
  });
});
