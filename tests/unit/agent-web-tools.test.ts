import { randomUUID } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { executeWebTool, htmlToText, isWebTool, parseSearchResults, WEB_TOOLS, type WebFetcher } from "../../src/main/services/agent-web-tools";
import type { ToolCall } from "../../src/main/services/provider-tool-turn";
import { stopRun, withRunControl } from "../../src/main/services/run-control";

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

  /** A page that sends its first bytes and then never finishes, until the request is aborted. */
  const tricklingFetcher: WebFetcher = async (_url, init) => new Response(new ReadableStream({
    start(stream) {
      stream.enqueue(new TextEncoder().encode("<p>first"));
      init.signal.addEventListener("abort", () => stream.error(init.signal.reason));
    },
  }), { status: 200, headers: { "content-type": "text/html" } });

  test("a page that never finishes is given up after the time limit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const outcome = executeWebTool(call("fetch_url", { url: "http://93.184.216.34/slow" }), tricklingFetcher);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await outcome).toBe("ERROR: Fetching 93.184.216.34 failed: no answer within 30s.");
    } finally {
      vi.useRealTimers();
    }
  });

  test("a redirect whose body never finishes is still followed", async () => {
    const requested: string[] = [];
    const fetcher: WebFetcher = async (url, init) => {
      requested.push(url);
      if (requested.length === 2) return new Response("<p>landed</p>", { status: 200, headers: { "content-type": "text/html" } });
      const stalled = await tricklingFetcher(url, init);
      return new Response(stalled.body, { status: 302, headers: { location: "http://93.184.216.35/final" } });
    };
    expect(await executeWebTool(call("fetch_url", { url: "http://93.184.216.34/start" }), fetcher)).toContain("landed");
  });

  test("stopping the run stops a fetch in progress", async () => {
    const runId = `run_${randomUUID()}`;
    const outcome = withRunControl(runId, () => executeWebTool(call("fetch_url", { url: "http://93.184.216.34/slow" }), tricklingFetcher));
    await new Promise((resolve) => setTimeout(resolve, 20));
    stopRun(runId);
    expect(await outcome).toBe("ERROR: Fetching 93.184.216.34 failed: Stopped by the operator.");
  });

  test("a page or search answered with an error status is a failed call, not data", async () => {
    const missing = await executeWebTool(call("fetch_url", { url: "http://93.184.216.34/gone" }), fetcherReturning([{ status: 404, body: "<h1>Not Found</h1>" }]).fetcher);
    expect(missing).toBe("ERROR: http://93.184.216.34/gone answered with status 404: Not Found");
    const limited = await executeWebTool(call("web_search", { query: "pricing" }), fetcherReturning([{ status: 429, body: "slow down" }]).fetcher);
    expect(limited).toMatch(/^ERROR: https:\/\/html\.duckduckgo\.com\/html\/\?q=pricing answered with status 429: slow down$/);
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

  test("fetch_url pages long pages and continues where the last page stopped", async () => {
    const paragraphs = Array.from({ length: 900 }, (_, index) => `<p>Paragraph ${index + 1} ${"word ".repeat(20)}</p>`).join("");
    const first = await executeWebTool(call("fetch_url", { url: "http://93.184.216.34/big" }), fetcherReturning([{ body: paragraphs }]).fetcher);
    const next = /\[more: pass start_line=(\d+) to continue\]/.exec(first);
    expect(next).not.toBeNull();
    expect(first).not.toContain("Paragraph 900 ");
    const rest = await executeWebTool(
      call("fetch_url", { url: "http://93.184.216.34/big", start_line: Number(next![1]), line_count: 5000 }),
      fetcherReturning([{ body: paragraphs }]).fetcher,
    );
    expect(rest).toMatch(/\[lines \d+-\d+ of \d+ in http:\/\/93\.184\.216\.34\/big\]/);
    const searched = await executeWebTool(call("fetch_url", { url: "http://93.184.216.34/big", search: "Paragraph 900 " }), fetcherReturning([{ body: paragraphs }]).fetcher);
    expect(searched).toContain("[1 matching lines for \"Paragraph 900\" in http://93.184.216.34/big]\n900: Paragraph 900 word");
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
