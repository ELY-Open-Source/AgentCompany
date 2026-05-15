import { describe, expect, it } from "vitest";
import { readResponseWithLimit } from "@main/skills/read-response-with-limit";

const encoder = new TextEncoder();

function responseFromChunks(chunks: string[], onCancel?: () => void): Response {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunk));
    },
    cancel() {
      onCancel?.();
    },
  });
  return new Response(stream);
}

describe("readResponseWithLimit", () => {
  it("returns text when the UTF-8 byte count matches the limit", async () => {
    const input = "hello 世界";
    const maxBytes = encoder.encode(input).byteLength;

    await expect(readResponseWithLimit(new Response(input), maxBytes)).resolves.toBe(input);
  });

  it("rejects oversized Content-Length before body reads", async () => {
    const response = new Response("small", {
      headers: { "Content-Length": "6" },
    });

    await expect(readResponseWithLimit(response, 5)).rejects.toThrow(
      "Response too large: 6 bytes (max 5)",
    );
  });

  it("rejects malformed Content-Length headers", async () => {
    const response = new Response("small", {
      headers: { "Content-Length": "NaN" },
    });

    await expect(readResponseWithLimit(response, 5)).rejects.toThrow(
      "Invalid Content-Length header: NaN",
    );
  });

  it("cancels the stream when the body exceeds the byte limit while reading", async () => {
    let cancelled = false;
    const response = responseFromChunks(["abc", "def"], () => {
      cancelled = true;
    });

    await expect(readResponseWithLimit(response, 5)).rejects.toThrow(
      "Response body exceeded 5 bytes",
    );
    expect(cancelled).toBe(true);
  });

  it("keeps byte-limit checks for non-streamable Response objects", async () => {
    const response = {
      headers: new Headers(),
      body: null,
      text: async () => "世界",
    } as Response;

    await expect(readResponseWithLimit(response, 5)).rejects.toThrow(
      "Response body exceeded 5 bytes",
    );
  });
});
