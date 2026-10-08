import { useMemo } from "react";
import { Button } from "../shared/ui";
import { t } from "../i18n/i18n";
import type { PageProps } from "./types";
import { activeOrgId, requireActiveEmployee } from "./types";
import { ConnectedList } from "./connectors/ConnectedList";
import { ToolkitCatalog } from "./connectors/ToolkitCatalog";
import { useConnectorCatalog } from "./connectors/useConnectorCatalog";
import { DEFAULT_CONNECTOR_ACCOUNT_LABEL } from "../../../shared/commands";

/**
 * The company's connector control room: what is connected, who holds it, and
 * the configured catalog to connect more. Connections are org-level; the CEO
 * decides which agents carry each toolkit's tools.
 */
export function ConnectorsPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const employee = requireActiveEmployee(snapshot);
  const { catalog, busySlug, busyAction, connectError, connect, disconnect, grant, revoke, retry } = useConnectorCatalog(orgId, actions);

  const accounts = useMemo(
    () => snapshot.connectorAccounts.filter((account) => account.orgId === orgId),
    [snapshot.connectorAccounts, orgId],
  );
  const grants = useMemo(
    () => snapshot.connectorGrants.filter((grant) => grant.orgId === orgId),
    [snapshot.connectorGrants, orgId],
  );
  const agents = useMemo(
    () => snapshot.agents.filter((agent) => agent.orgId === orgId && agent.lifecycle === "active"),
    [snapshot.agents, orgId],
  );
  const connectedSlugs = useMemo(
    () => new Set(accounts.filter((account) => account.status === "ACTIVE").map((account) => account.toolkitSlug)),
    [accounts],
  );
  const logoBySlug = useMemo(() => {
    const map = new Map<string, string | null>();
    if (catalog.phase === "ready") {
      for (const entry of catalog.entries) map.set(entry.slug, entry.logoUrl);
    }
    return map;
  }, [catalog]);

  return (
    <div style={{ maxWidth: 1060 }}>
      <h2 style={{ margin: "0 0 18px", fontSize: 16, fontWeight: 600 }}>{t("Connectors")}</h2>

      {connectError && (
        <div
          style={{
            color: "var(--text-2)",
            fontSize: 13,
            marginBottom: 14,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {connectError}
        </div>
      )}

      <ConnectedList
        accounts={accounts}
        grants={grants}
        agents={agents}
        logoBySlug={logoBySlug}
        busySlug={busySlug}
        busyAction={busyAction}
        onConnect={connect}
        onDelete={disconnect}
        onGrant={(agentId, toolkitSlug, accountLabel) => grant(agentId, toolkitSlug, accountLabel, employee.id)}
        onRevoke={revoke}
      />

      {catalog.phase === "error" && (
        <div className="row" style={{ gap: 10, padding: "24px 0" }}>
          <span
            style={{
              color: "var(--text-2)",
              fontSize: 13,
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {catalog.message}
          </span>
          <Button size="small" onClick={retry}>{t("Retry")}</Button>
        </div>
      )}
      {catalog.phase === "ready" && (
        <ToolkitCatalog
          entries={catalog.entries}
          connectedSlugs={connectedSlugs}
          busySlug={busySlug}
          onConnect={(slug) => connect(slug, DEFAULT_CONNECTOR_ACCOUNT_LABEL)}
        />
      )}
    </div>
  );
}
