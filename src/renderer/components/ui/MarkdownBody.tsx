import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Read-only markdown renderer used by message bubbles, comment bodies, and
 * other agent-authored text. AI agents consistently emit GFM flavour (bold,
 * bullet lists, numbered lists, inline code, fenced blocks, tables), so we
 * ship those plus strikethrough and task lists.
 *
 * Security: `react-markdown` disables HTML by default. We do not pass the
 * `rehype-raw` plugin, so any `<script>` / inline SVG in a message body is
 * rendered as literal text. Links open in the user's default browser via
 * Electron's window behaviour; we annotate them with `target="_blank"` and
 * `rel="noreferrer"` as a belt-and-suspenders guard against clipboard
 * spoofing.
 *
 * Style tokens stay aligned with `text-muted-foreground` bodies elsewhere —
 * the renderer overrides only the elements markdown introduces (lists,
 * code, tables, headings), inheriting the color / size / leading from the
 * wrapping container.
 */
export const MarkdownBody = memo(function MarkdownBody({ body }: { body: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-0.5 last:mb-0 marker:text-muted-foreground/60">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-0.5 last:mb-0 marker:text-muted-foreground/60">{children}</ol>,
        li: ({ children }) => <li className="pl-1">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        del: ({ children }) => <del className="text-muted-foreground/60">{children}</del>,
        code: ({ className, children }) => {
          const isBlock = (className ?? "").startsWith("language-");
          if (isBlock) {
            return (
              <code className="block whitespace-pre overflow-x-auto rounded-md bg-muted/70 px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground">
                {children}
              </code>
            );
          }
          return (
            <code className="rounded-sm bg-muted/70 px-1 py-0.5 font-mono text-[12px] text-foreground">
              {children}
            </code>
          );
        },
        pre: ({ children }) => <pre className="mb-2 last:mb-0">{children}</pre>,
        blockquote: ({ children }) => (
          <blockquote className="mb-2 border-l-2 border-border pl-3 italic last:mb-0">
            {children}
          </blockquote>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline decoration-dotted underline-offset-2 hover:opacity-80"
          >
            {children}
          </a>
        ),
        h1: ({ children }) => <h1 className="mb-1 mt-2 text-[14px] font-semibold text-foreground first:mt-0">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-1 mt-2 text-[13px] font-semibold text-foreground first:mt-0">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-1 mt-2 text-[13px] font-semibold text-foreground first:mt-0">{children}</h3>,
        table: ({ children }) => (
          <div className="mb-2 overflow-x-auto last:mb-0">
            <table className="w-full border-collapse text-[12px]">{children}</table>
          </div>
        ),
        th: ({ children }) => <th className="border border-border bg-muted/40 px-2 py-1 text-left font-semibold text-foreground">{children}</th>,
        td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
        hr: () => <hr className="my-2 border-border" />,
      }}
    >
      {body}
    </ReactMarkdown>
  );
});
