import { describe, expect, it } from "vitest";
import { decodeBodyToUtf8 } from "../../src/main/api-server/server-core";

describe("API request body encoding", () => {
  it("decodes valid UTF-8 JSON", () => {
    const raw = Buffer.from(JSON.stringify({ text: "中文" }), "utf8");

    expect(decodeBodyToUtf8(raw)).toBe("{\"text\":\"中文\"}");
  });

  it("rejects GBK bytes instead of repairing them", () => {
    const raw = Buffer.from([
      0x7b, 0x22, 0x74, 0x65, 0x78, 0x74, 0x22, 0x3a, 0x22,
      0xd6, 0xd0, 0xce, 0xc4,
      0x22, 0x7d,
    ]);

    expect(() => decodeBodyToUtf8(raw)).toThrow();
  });
});
