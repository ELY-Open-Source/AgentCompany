import { useCallback } from "react";
import type { ConnectorId } from "@shared/types";
import type { ProfileSnapshot } from "@shared/types";
import type { openTerminalCommandSchema } from "@shared/contracts";
import type { z } from "zod";
import { unwrap } from "../../lib/desktop";

export function useConnectorCallbacks(connectors: ProfileSnapshot["connectors"]) {
  const handleTestConnector = useCallback(async (connectorId: string) => {
    try {
      unwrap(await window.agentCompany.testConnector(connectorId as ConnectorId));
    } catch (error) {
      console.warn(
        `[onboarding/useConnectorCallbacks] testConnector(${connectorId}) failed (result reflected via domain-changed): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, []);

  const handleSaveConnector = useCallback(async (connectorId: string, envBindingText: string, model: string | null, notes?: string) => {
    const connector = connectors.find((c) => c.id === connectorId);
    if (!connector) return;
    try {
      unwrap(await window.agentCompany.saveConnector({
        id: connectorId as ConnectorId,
        model,
        envBindingText,
        notes: notes ?? connector.notes,
      }));
      // Run health check AFTER save completes so the probe uses the new config
      unwrap(await window.agentCompany.testConnector(connectorId as ConnectorId));
    } catch (error) {
      console.warn(
        `[onboarding/useConnectorCallbacks] saveConnector+testConnector(${connectorId}) failed (result reflected via domain-changed): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, [connectors]);

  const handleInstallCommand = useCallback(async (commandKey: z.infer<typeof openTerminalCommandSchema>["commandKey"]) => {
    try {
      unwrap(await window.agentCompany.openTerminalCommand({ commandKey }));
    } catch (error) {
      console.warn(
        `[onboarding/useConnectorCallbacks] openTerminalCommand(${commandKey}) failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    // Poll all connectors after install (install may make a new CLI available)
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      if (attempts > 12) { clearInterval(poll); return; }
      for (const c of connectors) {
        if (c.status !== "ready") {
          try {
            unwrap(await window.agentCompany.testConnector(c.id as ConnectorId));
          } catch (error) {
            console.warn(
              `[onboarding/useConnectorCallbacks] post-install testConnector(${c.id}) failed (attempt ${attempts}): ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    }, 5000);
  }, [connectors]);

  return { handleTestConnector, handleSaveConnector, handleInstallCommand };
}
