import { useMemo, useState } from "react";
import { Button, Icon, Pill } from "../../shared/ui";
import type { ComposioToolkitSummaryDto } from "../../../../shared/commands";

/** Deterministic tile color for a toolkit's letter glyph. */
const TILE_COLORS = ["#5e6ad2", "#3b82a0", "#7c5cb0", "#3f8f5f", "#b0684f", "#a05c86", "#6f7d3d", "#4f6fb0"];

function tileColor(slug: string): string {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) | 0;
  return TILE_COLORS[Math.abs(hash) % TILE_COLORS.length];
}

export function ToolkitTile({ name, slug, size = 34 }: { name: string; slug: string; size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 9,
        background: tileColor(slug),
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.44,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {(name || slug).charAt(0).toUpperCase()}
    </span>
  );
}

export function ToolkitCatalog({
  toolkits,
  connectedSlugs,
  busySlug,
  onConnect,
}: {
  toolkits: ComposioToolkitSummaryDto[];
  connectedSlugs: Set<string>;
  busySlug: string | null;
  onConnect: (toolkit: ComposioToolkitSummaryDto) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return toolkits;
    return toolkits.filter((toolkit) =>
      toolkit.name.toLowerCase().includes(trimmed) ||
      toolkit.slug.includes(trimmed) ||
      toolkit.categories.some((category) => category.toLowerCase().includes(trimmed)),
    );
  }, [toolkits, query]);

  return (
    <section>
      <div className="row" style={{ marginBottom: 12, gap: 10 }}>
        <div className="section-label" style={{ flex: 1 }}>Catalog</div>
        <div className="row" style={{ gap: 6, background: "var(--panel-2)", borderRadius: 8, padding: "5px 10px", width: 240 }}>
          <Icon name="search" size={13} color="var(--text-3)" />
          <input
            aria-label="Search connectors"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search connectors"
            style={{ border: 0, outline: 0, background: "transparent", fontSize: 13, flex: 1, minWidth: 0, color: "var(--text-1)" }}
          />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10 }}>
        {filtered.map((toolkit) => {
          const connected = connectedSlugs.has(toolkit.slug);
          return (
            <div
              key={toolkit.slug}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 12,
                background: "var(--panel)",
                display: "flex",
                gap: 10,
                alignItems: "flex-start",
              }}
            >
              <ToolkitTile name={toolkit.name} slug={toolkit.slug} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {toolkit.name}
                  </span>
                  {toolkit.categories[0] && <Pill>{toolkit.categories[0]}</Pill>}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-3)",
                    lineHeight: 1.45,
                    marginTop: 2,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    minHeight: 34,
                  }}
                >
                  {toolkit.description}
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  {connected ? (
                    <Pill tone="green" dot>Connected</Pill>
                  ) : (
                    <Button
                      size="small"
                      disabled={busySlug !== null}
                      onClick={() => onConnect(toolkit)}
                    >
                      {busySlug === toolkit.slug ? "Opening…" : "Connect"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
