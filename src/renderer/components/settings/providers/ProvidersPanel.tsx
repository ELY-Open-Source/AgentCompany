import { useEffect, useMemo, useState } from "react";
import { MagnifyingGlass } from "../../ui/icons";
import type { CredentialSummary } from "@shared/contracts/schemas-credentials";
import {
  CONNECTOR_CATALOG,
  type ConnectorAuthKind,
  type ConnectorCatalogEntry,
} from "@shared/connector-catalog";
import { ProviderRow } from "./ProviderRow";
import { useT } from "../../../i18n";

interface ProvidersPanelProps {
  catalog?: ConnectorCatalogEntry[];
}

export function ProvidersPanel({ catalog }: ProvidersPanelProps = {}) {
  const t = useT();
  const FILTERS: Array<{ id: "all" | "configured" | "available"; label: string }> = [
    { id: "all", label: t("providers.filterAll") },
    { id: "configured", label: t("providers.filterConfigured") },
    { id: "available", label: t("providers.filterAvailable") },
  ];

  const GROUP_ORDER: Array<{ id: ConnectorAuthKind; label: string }> = [
    { id: "oauth", label: t("providers.groupOAuth") },
    { id: "api_key", label: t("providers.groupApiKey") },
    { id: "azure", label: t("providers.groupAzure") },
    { id: "aws", label: t("providers.groupAws") },
    { id: "gcp_adc", label: t("providers.groupGcp") },
  ];

  const entries = catalog ?? CONNECTOR_CATALOG;
  const [credentials, setCredentials] = useState<Map<string, CredentialSummary>>(new Map());
  const [filter, setFilter] = useState<"all" | "configured" | "available">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const desktop = window.agentCompany;
    if (!desktop) return;
    let cancelled = false;
    const refresh = async () => {
      const result = await desktop.listCredentials();
      if (cancelled || !result.ok) return;
      setCredentials(new Map(result.data.map((row) => [row.connectorId, row])));
    };
    void refresh();
    const unsubscribe = desktop.subscribe((event) => {
      if (event.type !== "credentials-changed") return;
      void refresh();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries.filter((entry) => {
      const hasCredential = credentials.has(entry.id);
      if (filter === "configured" && !hasCredential) return false;
      if (filter === "available" && hasCredential) return false;
      if (needle.length === 0) return true;
      return (
        entry.label.toLowerCase().includes(needle) ||
        entry.id.includes(needle) ||
        entry.provider.toLowerCase().includes(needle)
      );
    });
  }, [entries, credentials, filter, search]);

  const grouped = useMemo(() => {
    const byKind = new Map<ConnectorAuthKind, ConnectorCatalogEntry[]>();
    for (const entry of filtered) {
      const list = byKind.get(entry.auth.type) ?? [];
      list.push(entry);
      byKind.set(entry.auth.type, list);
    }
    return GROUP_ORDER.map((group) => ({
      ...group,
      items: byKind.get(group.id) ?? [],
    })).filter((group) => group.items.length > 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, t]);

  const configuredCount = useMemo(
    () => entries.filter((entry) => credentials.has(entry.id)).length,
    [entries, credentials],
  );

  return (
    <section aria-label={t("providers.ariaLabel")} className="space-y-4">
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
            placeholder={t("providers.search")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={t("providers.search")}
            className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-foreground/40"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden text-[11px] font-medium text-muted-foreground sm:block">
            {t("providers.connectedCount").replace("{n}", String(configuredCount)).replace("{total}", String(entries.length))}
          </div>
          <div
            role="tablist"
            aria-label={t("providers.filterAriaLabel")}
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
          {t("providers.noMatch")}
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
