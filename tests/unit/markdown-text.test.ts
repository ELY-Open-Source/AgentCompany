import { describe, expect, it } from "vitest";
import { normalizeMarkdownText } from "../../src/shared/markdown-text";

describe("normalizeMarkdownText", () => {
  it("converts escaped markdown line breaks into renderable markdown", () => {
    expect(normalizeMarkdownText("Intro\\n\\n## Plan\\n- First\\n- Second")).toBe("Intro\n\n## Plan\n- First\n- Second");
  });

  it("normalizes actual CRLF input to LF", () => {
    expect(normalizeMarkdownText("One\r\nTwo\rThree")).toBe("One\nTwo\nThree");
  });
});
