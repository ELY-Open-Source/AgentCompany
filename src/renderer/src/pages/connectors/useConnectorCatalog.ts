import { judgeSignIn } from "./sign-in";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectorCatalogEntry } from "../../../../shared/commands";
import type { SnapshotActions } from "../../app/useSnapshot";
import type { DesktopResult } from "../../../../shared/result";
import type { AppSnapshot } from "../../../../shared/domain";

export type CatalogState =
  | { phase: "loading" }
  | { phase: "ready"; entries: ConnectorCatalogEntry[] }
  | { phase: "error"; message: string };

type CatalogSlot = { orgId: string; state: CatalogState } | null;

/** Whether the account statuses on screen are what Composio reports now; the catalog loading says nothing about this. */
export type AccountSync = { phase: "syncing" } | { phase: "synced"; at: string } | { phase: "failed"; message: string };

/** Where a sign-in started from this window stands; it always ends connected, failed, or timed out. */
export type SignIn = { slug: string; label: string; accountId: string } & (
  | { phase: "waiting"; check: number; checks: number }
  | { phase: "connected" }
  | { phase: "timed_out" }
  | { phase: "failed"; message: string }
);

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
  busyAction: "connect" | "disconnect" | null;
  connectError: string | null;
  signIn: SignIn | null;
  accountSync: AccountSync;
  syncAccounts: () => void;
  stopWaiting: () => void;
  checkAgain: () => void;
  connect: (toolkitSlug: string, label: string) => void;
  disconnect: (toolkitSlug: string, label: string) => void;
  grant: (agentId: string, toolkitSlug: string, accountLabel: string, employeeId: string) => void;
  revoke: (agentId: string, toolkitSlug: string) => void;
  retry: () => void;
} {
  const [catalogSlot, setCatalogSlot] = useState<CatalogSlot>(null);
  const [busy, setBusy] = useState<{ slug: string; action: "connect" | "disconnect" } | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [signIn, setSignIn] = useState<SignIn | null>(null);
  const [sync, setSync] = useState<{ orgId: string; state: AccountSync } | null>(null);
  const accountSync: AccountSync = sync && sync.orgId === orgId ? sync.state : { phase: "syncing" };
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Each sign-in check run has its own number; a stopped or replaced run's late answers are dropped.
  const pollRun = useRef(0);
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
    pollRun.current += 1;
    if (pollTimer.current) clearTimeout(pollTimer.current);
  }, []);

  // Every account refresh records whether it worked, so stale statuses are never shown as current.
  const refreshAccounts = useCallback(
    () => actions.run(() => window.agentCompany.refreshComposioAccounts({ orgId })).then((data) => {
      setSync({ orgId, state: { phase: "synced", at: new Date().toISOString() } });
      return data;
    }, (error: unknown) => {
      setSync({ orgId, state: { phase: "failed", message: error instanceof Error ? error.message : String(error) } });
      throw error;
    }),
    [actions, orgId],
  );

  const syncAccounts = useCallback(() => {
    setSync({ orgId, state: { phase: "syncing" } });
    // The outcome is shown through accountSync.
    void refreshAccounts().catch(() => undefined);
  }, [refreshAccounts, orgId]);

  useEffect(() => {
    let live = true;
    void window.agentCompany.refreshComposioAccounts({ orgId }).then((result) => {
      if (!live) return;
      setSync({ orgId, state: result.ok ? { phase: "synced", at: new Date().toISOString() } : { phase: "failed", message: result.error.message } });
    }, (error: unknown) => {
      if (live) setSync({ orgId, state: { phase: "failed", message: error instanceof Error ? error.message : String(error) } });
    });
    return () => {
      live = false;
    };
  }, [orgId]);

  // Checks the account until it is ACTIVE, failed, or the checks run out; the card stays busy until one of those.
  const pollUntilActive = useCallback((toolkitSlug: string, label: string, accountId: string) => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollRun.current += 1;
    const run = pollRun.current;
    const sign = { slug: toolkitSlug, label, accountId };
    const end = (outcome: SignIn) => {
      if (pollRun.current !== run) return;
      setSignIn(outcome);
      setBusy(null);
    };
    const poll = (attempt: number) => {
      if (pollRun.current !== run) return;
      if (attempt >= CONNECT_POLL_ATTEMPTS) {
        end({ ...sign, phase: "timed_out" });
        return;
      }
      setSignIn({ ...sign, phase: "waiting", check: attempt + 1, checks: CONNECT_POLL_ATTEMPTS });
      pollTimer.current = setTimeout(() => {
        void refreshAccounts().then((data) => {
          if (pollRun.current !== run) return;
          const account = data?.connectorAccounts.find(
            (item) => item.orgId === orgId && item.toolkitSlug === toolkitSlug && item.label === label,
          );
          const judged = judgeSignIn(account, accountId);
          if (judged.outcome === "connected") return end({ ...sign, phase: "connected" });
          if (judged.outcome === "failed") return end({ ...sign, phase: "failed", message: judged.message });
          poll(attempt + 1);
        }, (error: unknown) => end({ ...sign, phase: "failed", message: error instanceof Error ? error.message : String(error) }));
      }, CONNECT_POLL_INTERVAL_MS);
    };
    poll(0);
  }, [refreshAccounts, orgId]);

  const stopWaiting = useCallback(() => {
    pollRun.current += 1;
    if (pollTimer.current) clearTimeout(pollTimer.current);
    setSignIn(null);
    setBusy(null);
  }, []);

  const checkAgain = useCallback(() => {
    if (!signIn) return;
    setBusy({ slug: signIn.slug, action: "connect" });
    pollUntilActive(signIn.slug, signIn.label, signIn.accountId);
  }, [signIn, pollUntilActive]);

  const connect = useCallback((toolkitSlug: string, label: string) => {
    pollRun.current += 1;
    const run = pollRun.current;
    if (pollTimer.current) clearTimeout(pollTimer.current);
    setBusy({ slug: toolkitSlug, action: "connect" });
    setConnectError(null);
    setSignIn(null);
    void window.agentCompany
      .connectComposioToolkit({ orgId, toolkitSlug, label })
      .then(async (result) => {
        // Unmounted, stopped or replaced while connecting: this answer starts nothing.
        if (pollRun.current !== run) return;
        if (!result.ok) {
          setConnectError(result.error.message);
          setBusy(null);
          return;
        }
        // Opening the browser is not being connected: the card stays busy while the sign-in is checked.
        pollUntilActive(toolkitSlug, label.trim().toLowerCase(), result.data.accountId);
        if (result.data.redirectUrl) {
          const opened = await window.agentCompany.openExternalUrl(result.data.redirectUrl);
          if (!opened.ok) setConnectError(opened.error.message);
        }
      }, (error: unknown) => {
        if (pollRun.current !== run) return;
        setConnectError(error instanceof Error ? error.message : String(error));
        setBusy(null);
      });
  }, [orgId, pollUntilActive]);

  const disconnect = useCallback((toolkitSlug: string, label: string) => {
    setBusy({ slug: toolkitSlug, action: "disconnect" });
    setConnectError(null);
    void actions.run(() => window.agentCompany.disconnectComposioToolkit({ orgId, toolkitSlug, label }))
      .catch((error: unknown) => setConnectError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(null));
  }, [actions, orgId]);

  // A refused grant or revoke is shown on the page, not dropped.
  const runGrantChange = useCallback((change: () => Promise<DesktopResult<AppSnapshot>>) => {
    setConnectError(null);
    void actions.run(change).catch((error: unknown) => setConnectError(error instanceof Error ? error.message : String(error)));
  }, [actions]);
  const grant = useCallback((agentId: string, toolkitSlug: string, accountLabel: string, employeeId: string) => {
    runGrantChange(() => window.agentCompany.grantConnector({ orgId, agentId, toolkitSlug, accountLabel, employeeId }));
  }, [runGrantChange, orgId]);
  const revoke = useCallback((agentId: string, toolkitSlug: string) => {
    runGrantChange(() => window.agentCompany.revokeConnector({ orgId, agentId, toolkitSlug }));
  }, [runGrantChange, orgId]);

  return {
    catalog,
    busySlug: busy?.slug ?? null,
    busyAction: busy?.action ?? null,
    connectError,
    signIn,
    accountSync,
    syncAccounts,
    stopWaiting,
    checkAgain,
    connect,
    disconnect,
    grant,
    revoke,
    retry: load,
  };
}
