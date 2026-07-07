import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import { postEventStream, postJson, ProviderHttpError } from "../../src/main/services/provider-http";

let server: Server | null = null;

function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  return new Promise((resolve) => {
    server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const address = server!.address() as { port: number };
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

afterEach(() => {
  server?.closeAllConnections();
  server?.close();
  server = null;
});

describe("provider http deadlines", () => {
  test("a body that stalls after headers fails instead of hanging", async () => {
    const baseUrl = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"partial":');
      // Never ends the body.
    });
    await expect(postJson(baseUrl, {}, {}, { bodyTimeoutMs: 100 }))
      .rejects.toThrow(/timed out/);
  });

  test("a server that never sends headers fails at the header deadline", async () => {
    const baseUrl = await listen(() => {
      // Accept the request and never respond.
    });
    await expect(postJson(baseUrl, {}, {}, { headersTimeoutMs: 100 }))
      .rejects.toThrow(/timed out/);
  });

  test("an event stream that goes idle fails instead of hanging", async () => {
    const baseUrl = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write('data: {"first":true}\n\n');
      // Never sends another event.
    });
    const stream = await postEventStream(baseUrl, {}, {}, { idleTimeoutMs: 100 });
    const seen: unknown[] = [];
    await expect((async () => {
      for await (const message of stream.messages) seen.push(message.data);
    })()).rejects.toThrow(ProviderHttpError);
    expect(seen).toEqual([{ first: true }]);
  });

  test("a healthy response is returned unchanged", async () => {
    const baseUrl = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"ok":true}');
    });
    const result = await postJson(baseUrl, {}, {});
    expect(result.data).toEqual({ ok: true });
  });
});
