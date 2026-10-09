import type { ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** The slice of a hast node this file reads and builds. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** Placeholders that mark the resolved mention ranges; the random nonce keeps a body (or an entity in it) from forging one. */
function placeholders() {
  const nonce = Array.from(crypto.getRandomValues(new Uint32Array(2)), (part) => part.toString(16).padStart(8, "0")).join("");
  return {
    make: (index: number) => `@\uE000${nonce}x${index}\uE001`,
    plain: new RegExp(`@\\uE000${nonce}x(\\d+)\\uE001`, "g"),
    // The parser percent-encodes the private-use characters inside a URL.
    encoded: new RegExp(`@%EE%80%80${nonce}x(\\d+)%EE%80%81`, "g"),
  };
}

/** Turns placeholders into `<span data-mention="i">` outside code, and back into the mention text inside code and attributes. */
function mentionSpans(tokens: string[], marks: ReturnType<typeof placeholders>) {
  const token = (_match: string, index: string) => tokens[Number(index)];
  const restore = (text: string) => text.replace(marks.plain, token).replace(marks.encoded, token);
  const split = (value: string): HastNode[] => {
    const pieces: HastNode[] = [];
    let cursor = 0;
    for (const match of value.matchAll(marks.plain)) {
      if (match.index > cursor) pieces.push({ type: "text", value: value.slice(cursor, match.index) });
      pieces.push({ type: "element", tagName: "span", properties: { dataMention: match[1] }, children: [{ type: "text", value: tokens[Number(match[1])] }] });
      cursor = match.index + match[0].length;
    }
    if (cursor < value.length) pieces.push({ type: "text", value: value.slice(cursor) });
    return pieces;
  };
  const walk = (node: HastNode, inCode: boolean): void => {
    for (const [key, property] of Object.entries(node.properties ?? {})) {
      if (typeof property === "string") node.properties![key] = restore(property);
    }
    if (!node.children) return;
    const childInCode = inCode || node.tagName === "code" || node.tagName === "pre";
    node.children = node.children.flatMap((child) => {
      if (child.type !== "text" || child.value === undefined) {
        walk(child, childInCode);
        return [child];
      }
      return childInCode ? [{ ...child, value: restore(child.value) }] : split(child.value);
    });
  };
  return () => (tree: HastNode) => walk(tree, false);
}

/** The app window opens no new windows, so a link goes to the system browser through the main process. */
function openLink(href: string): void {
  void window.agentCompany.openExternalUrl(href).then((result) => {
    if (!result.ok) console.error(`[chat] could not open ${href}: ${result.error.message}`);
  });
}

const COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      rel="noreferrer"
      style={{ color: "var(--accent)" }}
      onClick={(event) => {
        event.preventDefault();
        if (href) openLink(href);
      }}
    >
      {children}
    </a>
  ),
};

/** A chat message body as GitHub-flavored markdown; raw HTML and images are not rendered, and mentions become chips. */
export function MessageMarkdown({ body, mentions, renderMention }: {
  body: string;
  /** Mention ranges in `body`, sorted and non-overlapping. */
  mentions: Array<{ start: number; end: number }>;
  renderMention: (index: number) => ReactNode;
}) {
  const components: Components = {
    ...COMPONENTS,
    span: ({ node: _node, children, ...props }) => {
      const index = (props as Record<string, unknown>)["data-mention"];
      return typeof index === "string" ? renderMention(Number(index)) : <span {...props}>{children}</span>;
    },
  };
  const marks = placeholders();
  let source = "";
  let cursor = 0;
  mentions.forEach((mention, index) => {
    source += body.slice(cursor, mention.start) + marks.make(index);
    cursor = mention.end;
  });
  source += body.slice(cursor);
  const tokens = mentions.map((mention) => body.slice(mention.start, mention.end));
  return (
    <div className="md-body">
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[mentionSpans(tokens, marks)]} skipHtml disallowedElements={["img"]} components={components}>
        {source}
      </Markdown>
    </div>
  );
}
