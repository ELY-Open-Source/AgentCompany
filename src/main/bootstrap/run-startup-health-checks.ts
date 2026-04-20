import type { AppDatabase } from "../database";
import type { createConnectorHealthService } from "../connector-health-service";

interface Logger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

type ConnectorHealthService = ReturnType<typeof createConnectorHealthService>;

export async function runStartupHealthChecks(
  db: AppDatabase,
  connectorHealth: ConnectorHealthService | null | undefined,
  logger: Logger,
): Promise<void> {
  if (!connectorHealth) return;
  const connectors = db.snap.listSnapshot().connectors;
  const results = await Promise.allSettled(
    connectors.map((connector) => connectorHealth.checkConnector(connector.id)),
  );
  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    if (result.status === "rejected") {
      logger.warn(`[bootstrap] Connector health check failed for ${connectors[i]?.id}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    }
  }
  logger.info(`[bootstrap] Connector health checks completed (${results.filter((r) => r.status === "fulfilled").length}/${connectors.length} succeeded)`);
}
