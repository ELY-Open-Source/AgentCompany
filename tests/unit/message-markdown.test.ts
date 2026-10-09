import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { MessageMarkdown } from "../../src/renderer/src/pages/chat/MessageMarkdown";

const render = (body: string, mentions: Array<{ start: number; end: number }> = []) => renderToStaticMarkup(createElement(MessageMarkdown, {
  body,
  mentions,
  renderMention: (index: number) => createElement("b", { "data-chip": index }, "CHIP"),
}));

describe("message markdown", () => {
  test("renders code blocks, tables and nested lists instead of raw markup", () => {
    const html = render("Plan:\n\n```ts\nconst a = 1;\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n- one\n  - nested\n- two");
    expect(html).toContain("<pre");
    expect(html).toContain("const a = 1;");
    expect(html).toContain("<table");
    expect(html).toContain("<td>2</td>");
    expect(html).toMatch(/<li>one\s*<ul[^>]*>\s*<li>nested<\/li>/);
    expect(html).not.toContain("```");
  });

  test("keeps line breaks, drops raw HTML and images, and opens links outside", () => {
    const html = render("line one\nline two <script>alert(1)</script> ![x](https://e.com/x.png) [site](https://e.com)");
    expect(html).toContain("line one\nline two");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain('href="https://e.com"');
  });

  test("turns mention ranges into chips, but not inside code", () => {
    const body = "Hi @Dana see `@Dana` and **@Dana**";
    const at = (from: number) => ({ start: body.indexOf("@Dana", from), end: body.indexOf("@Dana", from) + 5 });
    const first = at(0);
    const inCode = at(first.end);
    const bold = at(inCode.end);
    const html = render(body, [first, inCode, bold]);
    expect(html.match(/CHIP/g)).toHaveLength(2);
    expect(html).toContain("<code");
    expect(html).toMatch(/<code[^>]*>@Dana<\/code>/);
    expect(html).toMatch(/<strong><b data-chip="2">CHIP<\/b><\/strong>/);
  });

  test("finds mentions in text that entities or escapes changed", () => {
    for (const body of ["Use &amp; @Dana now", "Stars \\* and @Dana"]) {
      const start = body.indexOf("@Dana");
      expect(render(body, [{ start, end: start + 5 }]).match(/CHIP/g)).toHaveLength(1);
    }
  });

  test("chips the mention the server resolved, not a look-alike copy before it", () => {
    for (const body of ["&#64;Dana and @Dana", "\\@Dana and @Dana", "x@Dana and @Dana"]) {
      const start = body.lastIndexOf("@Dana");
      const html = render(body, [{ start, end: start + 5 }]);
      expect(html.match(/CHIP/g)).toHaveLength(1);
      expect(html).toMatch(/@Dana and <b data-chip="0">CHIP<\/b>/);
    }
  });

  test("a mention inside a link URL stays the URL's text", () => {
    const body = "[profile](https://e.com/@Dana)";
    const start = body.indexOf("@Dana");
    expect(render(body, [{ start, end: start + 5 }])).toContain('href="https://e.com/@Dana"');
  });

  test("an entity in the body cannot forge a mention chip", () => {
    for (const forged of ["&#xE000;0&#xE001;", "@&#xE000;0&#xE001;"]) {
      expect(render(`Hello ${forged}`).match(/CHIP/g)).toBeNull();
    }
  });
});
