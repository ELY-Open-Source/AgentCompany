import { getEnvApiKey } from "@mariozechner/pi-ai";
import type { AppDatabase } from "./database";
import { getConnectorDefinition } from "./connectors";
import type { ConnectorId } from "@shared/types";
import type { CredentialStore } from "./credentials";

interface ConnectorHealthDependencies {
  db: AppDatabase;
  logger: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  publishDomainChanged: () => void;
  credentialStore: CredentialStore;
}

type HealthState = {
  status: "ready" | "auth_required" | "not_installed" | "error";
  authState: "ok" | "required" | "error" | "unknown";
  lastError: string | null;
};

export function createConnectorHealthService({
  db,
  logger,
  publishDomainChanged,
  credentialStore,
}: ConnectorHealthDependencies) {
  function randomFallbackCompanyId() {
    const snapshot = db.listSnapshot();
    return snapshot.companies[0]?.id ?? "00000000-0000-0000-0000-000000000000";
  }

  function evaluateCredential(id: ConnectorId): HealthState {
    const definition = getConnectorDefinition(id);
    const stored = credentialStore.read(id);

    switch (definition.auth.type) {
      case "oauth": {
        if (stored?.kind !== "oauth") {
          return { status: "auth_required", authState: "required", lastError: "OAuth login required." };
        }
        const creds = stored.value;
        const expires = typeof creds.expires === "number" ? creds.expires : null;
        if (expires !== null && expires <= Date.now()) {
          return { status: "auth_required", authState: "required", lastError: "OAuth token expired." };
        }
        return { status: "ready", authState: "ok", lastError: null };
      }
      case "api_key": {
        if (stored?.kind === "api_key") {
          return { status: "ready", authState: "ok", lastError: null };
        }
        if (definition.provider && getEnvApiKey(definition.provider as never)) {
          return { status: "ready", authState: "ok", lastError: null };
        }
        return {
          status: "auth_required",
          authState: "required",
          lastError: `API key required (${definition.auth.envKey}).`,
        };
      }
      case "aws": {
        if (stored?.kind !== "aws") {
          return { status: "auth_required", authState: "required", lastError: "AWS credentials not configured." };
        }
        const cfg = stored.value;
        if (cfg.authMode === "profile" && !cfg.awsProfile) {
          return { status: "error", authState: "error", lastError: "AWS profile missing." };
        }
        if (cfg.authMode === "iam" && (!cfg.accessKeyId || !cfg.secretAccessKey)) {
          return { status: "error", authState: "error", lastError: "AWS IAM keys missing." };
        }
        if (cfg.authMode === "bearer" && !cfg.bearerToken) {
          return { status: "error", authState: "error", lastError: "AWS bearer token missing." };
        }
        return { status: "ready", authState: "ok", lastError: null };
      }
      case "azure": {
        if (stored?.kind !== "azure") {
          return { status: "auth_required", authState: "required", lastError: "Azure credentials not configured." };
        }
        const cfg = stored.value;
        if (!cfg.apiKey) {
          return { status: "error", authState: "error", lastError: "Azure OpenAI API key missing." };
        }
        if (!cfg.baseUrl && !cfg.resourceName) {
          return { status: "error", authState: "error", lastError: "Azure requires baseUrl or resourceName." };
        }
        return { status: "ready", authState: "ok", lastError: null };
      }
      case "gcp_adc": {
        if (stored?.kind !== "gcp_adc") {
          return { status: "auth_required", authState: "required", lastError: "GCP ADC not configured." };
        }
        const cfg = stored.value;
        if (!cfg.project || !cfg.location) {
          return { status: "error", authState: "error", lastError: "GCP project/location missing." };
        }
        return { status: "ready", authState: "ok", lastError: null };
      }
    }
  }

  async function checkConnector(id: ConnectorId) {
    const companyId = db.getCurrentCompanyId() ?? randomFallbackCompanyId();

    db.updateConnectorHealth({
      id,
      status: "detected",
      authState: db.getConnector(id).authState,
      version: null,
      lastError: null,
    });
    publishDomainChanged();

    try {
      const result = evaluateCredential(id);
      db.updateConnectorHealth({
        id,
        status: result.status,
        authState: result.authState,
        version: null,
        lastError: result.lastError,
      });
      db.addActivity({
        companyId,
        actor: "system",
        action: "connector.tested",
        entityType: "connector",
        entityId: id,
        detail: result.status,
      });
      logger.info(`[connector] Health check for ${id}: ${result.status}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[connector] Health check failed for ${id}: ${errorMessage}`);
      db.updateConnectorHealth({
        id,
        status: "error",
        authState: "unknown",
        version: null,
        lastError: errorMessage,
      });
    }
    publishDomainChanged();
  }

  return {
    checkConnector,
    randomFallbackCompanyId,
  };
}
