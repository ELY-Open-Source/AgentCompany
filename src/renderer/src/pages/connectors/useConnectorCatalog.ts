import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectorCatalogEntry } from "../../../../shared/commands";
import type { SnapshotActions } from "../../app/useSnapshot";

export type CatalogState =
  | { phase: "loading" }
  | { phase: "ready"; entries: ConnectorCatalogEntry[] }
  | { phase: "error"; message: string };

type CatalogSlot = { orgId: string; state: CatalogState } | null;

const CONNECT_POLL_INTERVAL_MS = 4000;
const CONNECT_POLL_ATTEMPTS = 15;

/**
 * The connector catalog and connect flow shared by the Connectors page and
 * the onboarding step: loads the catalog, starts connections through the
 * link flow, and polls account statuses until Composio reports ACTIVE.
 */
export function useConnectorCatalog(orgId: string, actions: SnapshotActions): {
  catalog: CatalogState;
  busySlug: string | null;
  connectError: string | null;
  connect: (entry: ConnectorCatalogEntry) => void;
  retry: () => void;
} {
  const [catalogSlot, setCatalogSlot] = useState<CatalogSlot>(null);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const catalog: CatalogState = catalogSlot && catalogSlot.orgId === orgId ? catalogSlot.state : { phase: "loading" };

  const load = useCallback(() => {
    setCatalogSlot(null);
    void window.agentCompany.listConnectorCatalog().then((result) => {
      setCatalogSlot({
        orgId,
        state: result.ok
          ? { phase: "ready", entries: result.data }
          : { phase: "error", message: result.error.message },
      });
    });
  }, [orgId]);

  useEffect(() => {
    let cancelled = false;
    void window.agentCompany.listConnectorCatalog().then((result) => {
      if (cancelled) return;
      setCatalogSlot({
        orgId,
        state: result.ok
          ? { phase: "ready", entries: result.data }
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

  // Account statuses sync from Composio on mount; a failure here is already
  // expressed by the catalog error state.
  useEffect(() => {
    void window.agentCompany.refreshComposioAccounts({ orgId });
  }, [orgId]);

  const refreshAccounts = useCallback(
    () => actions.run(() => window.agentCompany.refreshComposioAccounts({ orgId })),
    [actions, orgId],
  );

  const pollUntilActive = useCallback((toolkitSlug: string) => {
    const poll = (attempt: number) => {
      if (attempt >= CONNECT_POLL_ATTEMPTS) return;
      pollTimer.current = setTimeout(() => {
        void refreshAccounts().then((data) => {
          const account = data?.connectorAccounts.find(
            (item) => item.orgId === orgId && item.toolkitSlug === toolkitSlug,
          );
          if (account?.status === "ACTIVE") return;
          poll(attempt + 1);
        });
      }, CONNECT_POLL_INTERVAL_MS);
    };
    poll(0);
  }, [refreshAccounts, orgId]);

  const connect = useCallback((entry: ConnectorCatalogEntry) => {
    setBusySlug(entry.slug);
    setConnectError(null);
    void window.agentCompany
      .connectComposioToolkit({ orgId, toolkitSlug: entry.slug })
      .then(async (result) => {
        if (!result.ok) {
          setConnectError(result.error.message);
          return;
        }
        pollUntilActive(entry.slug);
        if (result.data.redirectUrl) {
          const opened = await window.agentCompany.openExternalUrl(result.data.redirectUrl);
          if (!opened.ok) setConnectError(opened.error.message);
        }
      })
      .finally(() => setBusySlug(null));
  }, [orgId, pollUntilActive]);

  return { catalog, busySlug, connectError, connect, retry: load };
}
