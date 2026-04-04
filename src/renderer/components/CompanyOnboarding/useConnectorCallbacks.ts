import { useCallback } from "react";
import type { ConnectorId } from "@shared/types";
import type { ProfileSnapshot } from "@shared/types";
import { unwrap } from "../../lib/desktop";

export function useConnectorCallbacks(connectors: ProfileSnapshot["connectors"]) {
  const handleTestConnector = useCallback(async (connectorId: string) => {
    try {
      unwrap(await window.agentCompany.testConnector(connectorId as ConnectorId));
    } catch {
      // Health check result is stored in DB and reflected via domain-changed
    }
  }, []);

  const handleSaveConnector = useCallback(async (connectorId: string, envBindingText: string, model: string | null, notes?: string) => {
    const connector = connectors.find((c) => c.id === connectorId);
    if (!connector) return;
    try {
      unwrap(await window.agentCompany.saveConnector({
        id: connectorId as ConnectorId,
        command: connector.command,
        model,
        envBindingText,
        notes: notes ?? connector.notes,
      }));
      // Run health check AFTER save completes so the probe uses the new config
      unwrap(await window.agentCompany.testConnector(connectorId as ConnectorId));
    } catch {
      // Error is non-fatal; result reflected via domain-changed
    }
  }, [connectors]);

  const handleLoginConnector = useCallback(async (connectorId: string) => {
    try {
      unwrap(await window.agentCompany.openConnectorAuthTerminal(connectorId as ConnectorId));
    } catch {
      // Terminal open failure is non-fatal
      return;
    }
    // Poll connector health after login terminal opens (same pattern as ConnectorEditor)
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      if (attempts > 12) { clearInterval(poll); return; }
      try {
        unwrap(await window.agentCompany.testConnector(connectorId as ConnectorId));
      } catch { /* health check result reflected via domain-changed */ }
    }, 5000);
  }, []);

  const handleInstallCommand = useCallback(async (title: string, command: string) => {
    try {
      unwrap(await window.agentCompany.openTerminalCommand({ title, command }));
    } catch {
      // Terminal open failure is non-fatal
      return;
    }
    // Poll all connectors after install (install may make a new CLI available)
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      if (attempts > 12) { clearInterval(poll); return; }
      for (const c of connectors) {
        if (c.status !== "ready") {
          try { unwrap(await window.agentCompany.testConnector(c.id as ConnectorId)); } catch { /* reflected via domain-changed */ }
        }
      }
    }, 5000);
  }, [connectors]);

  return { handleTestConnector, handleSaveConnector, handleLoginConnector, handleInstallCommand };
}
