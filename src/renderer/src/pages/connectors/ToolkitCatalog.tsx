import { useMemo, useState } from "react";
import { Button, Icon, Pill } from "../../shared/ui";
import type { ConnectorCatalogEntry } from "../../../../shared/commands";

/** Deterministic tile color for a toolkit's letter glyph. */
const TILE_COLORS = ["#5e6ad2", "#3b82a0", "#7c5cb0", "#3f8f5f", "#b0684f", "#a05c86", "#6f7d3d", "#4f6fb0"];

function tileColor(slug: string): string {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) | 0;
  return TILE_COLORS[Math.abs(hash) % TILE_COLORS.length];
}

export function ToolkitTile({ name, slug, logoUrl, size = 34 }: { name: string; slug: string; logoUrl: string | null; size?: number }) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: 9, objectFit: "cover", flexShrink: 0 }}
      />
    );
  }
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
  entries,
  connectedSlugs,
  busySlug,
  onConnect,
}: {
  entries: ConnectorCatalogEntry[];
  connectedSlugs: Set<string>;
  busySlug: string | null;
  onConnect: (toolkitSlug: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return entries;
    return entries.filter((entry) => entry.name.toLowerCase().includes(trimmed) || entry.slug.includes(trimmed));
  }, [entries, query]);

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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
        {filtered.map((entry) => {
          const connected = connectedSlugs.has(entry.slug);
          return (
            <div
              key={entry.slug}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 12,
                background: "var(--panel)",
                display: "flex",
                gap: 10,
                alignItems: "center",
              }}
            >
              <ToolkitTile name={entry.name} slug={entry.slug} logoUrl={entry.logoUrl} />
              <span style={{ fontWeight: 600, fontSize: 13.5, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {entry.name}
              </span>
              {connected ? (
                <Pill tone="green" dot>Connected</Pill>
              ) : (
                <Button size="small" disabled={busySlug !== null} onClick={() => onConnect(entry.slug)}>
                  {busySlug === entry.slug ? "Opening…" : "Connect"}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
