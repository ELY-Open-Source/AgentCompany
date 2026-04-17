import { useEffect, useMemo, useState } from "react";
import { MagnifyingGlass } from "../../ui/icons";
import type { CredentialSummary } from "@shared/contracts/schemas-credentials";
import { ProviderRow } from "./ProviderRow";

const desktop = (typeof window !== "undefined" ? window.agentCompany : null) as
  | (Window["agentCompany"] | null);

/** Provider catalog mirrored from the main process for renderer-only use.
 * Keep in sync with src/main/connector-definitions.ts when the catalog grows.
 * Each entry is referenced by its connectorId in IPC traffic. */
export interface ProvidersPanelEntry {
  id: string;
  label: string;
  kind: "oauth" | "api_key" | "azure" | "aws" | "gcp_adc";
}

const DEFAULT_CATALOG: ProvidersPanelEntry[] = [
  { id: "claude-pro", label: "Claude Pro / Max", kind: "oauth" },
  { id: "chatgpt-codex", label: "ChatGPT Plus / Pro (Codex)", kind: "oauth" },
  { id: "github-copilot", label: "GitHub Copilot", kind: "oauth" },
  { id: "gemini-cli", label: "Google Gemini CLI", kind: "oauth" },
  { id: "antigravity", label: "Google Antigravity", kind: "oauth" },
  { id: "anthropic", label: "Anthropic API", kind: "api_key" },
  { id: "openai", label: "OpenAI API", kind: "api_key" },
  { id: "google", label: "Google Gemini API", kind: "api_key" },
  { id: "mistral", label: "Mistral", kind: "api_key" },
  { id: "groq", label: "Groq", kind: "api_key" },
  { id: "cerebras", label: "Cerebras", kind: "api_key" },
  { id: "xai", label: "xAI", kind: "api_key" },
  { id: "openrouter", label: "OpenRouter", kind: "api_key" },
  { id: "vercel-ai-gateway", label: "Vercel AI Gateway", kind: "api_key" },
  { id: "zai", label: "ZAI", kind: "api_key" },
  { id: "opencode", label: "OpenCode Zen", kind: "api_key" },
  { id: "opencode-go", label: "OpenCode Go", kind: "api_key" },
  { id: "huggingface", label: "Hugging Face", kind: "api_key" },
  { id: "kimi-coding", label: "Kimi For Coding", kind: "api_key" },
  { id: "minimax", label: "MiniMax", kind: "api_key" },
  { id: "minimax-cn", label: "MiniMax (China)", kind: "api_key" },
  { id: "fireworks", label: "Fireworks AI", kind: "api_key" },
  { id: "fireworks-firepass", label: "Fireworks Fire Pass", kind: "api_key" },
  { id: "azure-openai", label: "Azure OpenAI", kind: "azure" },
  { id: "amazon-bedrock", label: "AWS Bedrock", kind: "aws" },
  { id: "google-vertex", label: "Google Vertex AI", kind: "gcp_adc" },
];

const FILTERS: Array<{ id: "all" | "configured" | "available"; label: string }> = [
  { id: "all", label: "All" },
  { id: "configured", label: "Connected" },
  { id: "available", label: "Available" },
];

const GROUP_ORDER: Array<{ id: ProvidersPanelEntry["kind"]; label: string }> = [
  { id: "oauth", label: "Sign in" },
  { id: "api_key", label: "API key" },
  { id: "azure", label: "Azure" },
  { id: "aws", label: "AWS" },
  { id: "gcp_adc", label: "Google Cloud" },
];

interface Props {
  catalog?: ProvidersPanelEntry[];
}

export function ProvidersPanel({ catalog }: Props) {
  const entries = catalog ?? DEFAULT_CATALOG;
  const [credentials, setCredentials] = useState<Map<string, CredentialSummary>>(new Map());
  const [filter, setFilter] = useState<"all" | "configured" | "available">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    void desktop.listCredentials().then((result) => {
      if (cancelled || !result.ok) return;
      setCredentials(new Map(result.data.map((row) => [row.connectorId, row])));
    });
    const unsubscribe = desktop.subscribe((event) => {
      if (event.type !== "credentials-changed") return;
      void desktop.listCredentials().then((result) => {
        if (!result.ok) return;
        setCredentials(new Map(result.data.map((row) => [row.connectorId, row])));
      });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const filtered = useMemo(() => {
    return entries.filter((entry) => {
      const hasCredential = credentials.has(entry.id);
      if (filter === "configured" && !hasCredential) return false;
      if (filter === "available" && hasCredential) return false;
      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        return entry.label.toLowerCase().includes(needle) || entry.id.includes(needle);
      }
      return true;
    });
  }, [entries, credentials, filter, search]);

  const grouped = useMemo(() => {
    const byKind = new Map<ProvidersPanelEntry["kind"], ProvidersPanelEntry[]>();
    for (const entry of filtered) {
      const list = byKind.get(entry.kind) ?? [];
      list.push(entry);
      byKind.set(entry.kind, list);
    }
    return GROUP_ORDER.map((group) => ({
      ...group,
      items: byKind.get(group.id) ?? [],
    })).filter((group) => group.items.length > 0);
  }, [filtered]);

  const configuredCount = useMemo(
    () => entries.filter((entry) => credentials.has(entry.id)).length,
    [entries, credentials],
  );

  return (
    <section aria-label="Providers" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <MagnifyingGlass
            size={14}
            weight="regular"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/70"
            aria-hidden
          />
          <input
            type="search"
            placeholder="Search providers"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search providers"
            className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground/40"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden text-[11px] font-medium text-muted-foreground sm:block">
            {configuredCount} / {entries.length} connected
          </div>
          <div
            role="tablist"
            aria-label="Filter providers"
            className="inline-flex rounded-md border border-border bg-background p-0.5"
          >
            {FILTERS.map((item) => {
              const active = filter === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(item.id)}
                  className={
                    "rounded px-3 py-1 text-[11px] font-medium transition-colors " +
                    (active
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {grouped.length === 0 ? (
        <div className="rounded-md border border-dashed border-border py-10 text-center text-[12px] text-muted-foreground">
          No providers match the current filter.
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.id}>
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {group.label}
                </h3>
                <span className="text-[10px] text-muted-foreground/70">
                  {group.items.length}
                </span>
              </div>
              <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-background/40">
                {group.items.map((entry) => (
                  <ProviderRow
                    key={entry.id}
                    entry={entry}
                    credential={credentials.get(entry.id) ?? null}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
