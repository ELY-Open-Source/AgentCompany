import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../shared/ui";
import type { ComposioToolkitSummaryDto } from "../../../shared/commands";
import type { PageProps } from "./types";
import { activeOrgId, requireActiveEmployee } from "./types";
import { ConnectedList } from "./connectors/ConnectedList";
import { ToolkitCatalog } from "./connectors/ToolkitCatalog";

type CatalogState =
  | { phase: "loading" }
  | { phase: "ready"; toolkits: ComposioToolkitSummaryDto[] }
  | { phase: "error"; message: string };

type CatalogSlot = { orgId: string; state: CatalogState } | null;

const CONNECT_POLL_INTERVAL_MS = 4000;
const CONNECT_POLL_ATTEMPTS = 15;

/**
 * The company's connector control room: what is connected, who may use it,
 * and the Composio catalog to connect more. Connections are org-level; the
 * grant chips decide which agents carry each toolkit's tools.
 */
export function ConnectorsPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const employee = requireActiveEmployee(snapshot);
  const [catalogSlot, setCatalogSlot] = useState<CatalogSlot>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const catalog: CatalogState = catalogSlot && catalogSlot.orgId === orgId ? catalogSlot.state : { phase: "loading" };

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

  useEffect(() => {
    let cancelled = false;
    void window.agentCompany.listComposioToolkits({ orgId }).then((result) => {
      if (cancelled) return;
      setCatalogSlot({
        orgId,
        state: result.ok
          ? { phase: "ready", toolkits: result.data }
          : { phase: "error", message: result.error.message },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  useEffect(() => () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
  }, []);

  const refreshAccounts = () =>
    actions.run(() => window.agentCompany.refreshComposioAccounts({ orgId }));

  const pollUntilActive = (toolkitSlug: string, attempt: number) => {
    if (attempt >= CONNECT_POLL_ATTEMPTS) return;
    pollTimer.current = setTimeout(() => {
      void refreshAccounts().then((data) => {
        const account = data?.connectorAccounts.find(
          (item) => item.orgId === orgId && item.toolkitSlug === toolkitSlug,
        );
        if (account?.status === "ACTIVE") return;
        pollUntilActive(toolkitSlug, attempt + 1);
      });
    }, CONNECT_POLL_INTERVAL_MS);
  };

  const connect = (toolkit: ComposioToolkitSummaryDto) => {
    setBusySlug(toolkit.slug);
    void window.agentCompany
      .connectComposioToolkit({ orgId, toolkitSlug: toolkit.slug, toolkitName: toolkit.name })
      .then((result) => {
        if (!result.ok) throw new Error(result.error.message);
        if (result.data.redirectUrl) {
          void window.agentCompany.openExternalUrl(result.data.redirectUrl);
        }
        pollUntilActive(toolkit.slug, 0);
      })
      .finally(() => setBusySlug(null));
  };

  const grant = (agentId: string, toolkitSlug: string) =>
    void actions.run(() => window.agentCompany.grantConnector({ orgId, agentId, toolkitSlug, employeeId: employee.id }));

  const revoke = (agentId: string, toolkitSlug: string) =>
    void actions.run(() => window.agentCompany.revokeConnector({ orgId, agentId, toolkitSlug, employeeId: employee.id }));

  return (
    <div style={{ maxWidth: 1060 }}>
      <div className="row" style={{ marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Connectors</h2>
          <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 2 }}>
            Company connections your agents can be granted to use.
          </div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <Button size="small" onClick={() => void refreshAccounts()}>Refresh</Button>
        </div>
      </div>

      <ConnectedList accounts={accounts} grants={grants} agents={agents} onGrant={grant} onRevoke={revoke} />

      {catalog.phase === "loading" && (
        <div style={{ color: "var(--text-3)", fontSize: 13, padding: "24px 0" }}>Loading catalog…</div>
      )}
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
          <Button size="small" onClick={() => {
            setCatalogSlot(null);
            void window.agentCompany.listComposioToolkits({ orgId }).then((result) => {
              setCatalogSlot({
                orgId,
                state: result.ok
                  ? { phase: "ready", toolkits: result.data }
                  : { phase: "error", message: result.error.message },
              });
            });
          }}>Retry</Button>
        </div>
      )}
      {catalog.phase === "ready" && (
        <ToolkitCatalog
          toolkits={catalog.toolkits}
          connectedSlugs={connectedSlugs}
          busySlug={busySlug}
          onConnect={connect}
        />
      )}
    </div>
  );
}
