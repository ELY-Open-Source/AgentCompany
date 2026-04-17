import { useEffect, useState } from "react";
import type { ConnectorRecord } from "@shared/types";
import { findConnectorCatalogEntry } from "@shared/connector-catalog";
import type { CredentialSummary } from "@shared/contracts/schemas-credentials";
import { InlineNotice, StatusPill } from "./ui";

const AUTH_KIND_LABEL: Record<string, string> = {
  oauth: "OAuth",
  api_key: "API key",
  aws: "AWS",
  azure: "Azure",
  gcp_adc: "Google Vertex (ADC)",
};

/**
 * Legacy connector detail view. Real configuration happens in
 * Settings → Providers. Here we only surface catalog metadata and the current
 * credential status pulled from the pi-mono credential store.
 */
export function ConnectorEditor({
  connector,
}: {
  connector: ConnectorRecord;
  onSaved: () => Promise<void>;
}) {
  const [credential, setCredential] = useState<CredentialSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const catalog = findConnectorCatalogEntry(connector.id);

  useEffect(() => {
    const desktop = window.agentCompany;
    if (!desktop) return;
    let cancelled = false;
    const refresh = async () => {
      const result = await desktop.listCredentials();
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setCredential(result.data.find((row) => row.connectorId === connector.id) ?? null);
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
  }, [connector.id]);

  return (
    <div className="grid gap-4">
      {error ? <InlineNotice message={error} /> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">Status</div>
          <div className="flex items-center gap-3">
            <StatusPill status={connector.status} />
            <span className="text-[12px] text-muted-foreground">
              {credential ? credential.status : "not configured"}
            </span>
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">Auth</div>
          <div className="text-[13px] text-foreground">
            {catalog ? AUTH_KIND_LABEL[catalog.auth.type] ?? catalog.auth.type : "Unknown"}
          </div>
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">Provider id</div>
        <div className="font-mono text-[12px] text-foreground">{catalog?.provider ?? connector.id}</div>
      </div>
      {catalog?.description ? (
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">Description</div>
          <div className="text-[12px] leading-relaxed text-muted-foreground">{catalog.description}</div>
        </div>
      ) : null}
      {catalog?.notes ? (
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">Notes</div>
          <div className="text-[12px] leading-relaxed text-muted-foreground">{catalog.notes}</div>
        </div>
      ) : null}
      <div className="rounded-lg border border-border bg-muted px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
        Manage credentials in Settings → Providers. Status and OAuth flows are handled by the pi-mono credential store.
      </div>
      {credential?.lastError ? (
        <div className="rounded-lg border border-border bg-muted px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Latest credential error
          </div>
          <div>{credential.lastError}</div>
        </div>
      ) : null}
    </div>
  );
}
