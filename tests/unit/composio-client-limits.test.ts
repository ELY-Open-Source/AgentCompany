import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";

const chunksToSend: Buffer[] = [];
let aborted = false;

vi.mock("electron", () => ({
  net: {
    request: () => {
      const request = new EventEmitter() as EventEmitter & { setHeader: () => void; write: () => void; end: () => void; abort: () => void };
      request.setHeader = () => undefined;
      request.write = () => undefined;
      request.abort = () => { aborted = true; };
      request.end = () => {
        const response = new EventEmitter() as EventEmitter & { statusCode: number };
        response.statusCode = 200;
        request.emit("response", response);
        for (const chunk of chunksToSend) response.emit("data", chunk);
        response.emit("end");
      };
      return request;
    },
  },
}));

const { ComposioClient } = await import("../../src/main/services/composio/composio-client");

describe("composio client response limits", () => {
  test("a multi-byte character split across chunks decodes intact", async () => {
    const json = Buffer.from(JSON.stringify({ items: [{ slug: "GMAIL_SEND", description: "发送邮件" }] }), "utf8");
    const split = json.indexOf(Buffer.from("邮", "utf8")) + 1;
    chunksToSend.splice(0, chunksToSend.length, json.subarray(0, split), json.subarray(split));
    const tools = await new ComposioClient("ak_test").getTools(["gmail"]);
    expect(tools.map((tool) => [tool.name, tool.description])).toEqual([["GMAIL_SEND", "发送邮件"]]);
  });

  test("a response over the byte cap aborts and fails loudly", async () => {
    aborted = false;
    chunksToSend.splice(0, chunksToSend.length, Buffer.alloc(1_500_000, 32), Buffer.alloc(1_500_000, 32));
    await expect(new ComposioClient("ak_test").getTools(["gmail"])).rejects.toThrow("returned more than 2000000 bytes");
    expect(aborted).toBe(true);
  });
});
